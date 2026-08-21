import { openai } from "@ai-sdk/openai";
import {
  generateText,
  stepCountIs,
  Output,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { getDb } from "@/lib/db";
import { initChatSession, saveAssistantMessage } from "@/lib/chat-session";
import { DEFAULT_MODEL } from "@/lib/config";

const tracer = trace.getTracer("ai-aug-workflows-agents");

// ─── Workflow: Parallelization ─────────────────────────────────────────────────
// Anthropic describes two variations of parallelization:
//   - Sectioning: breaking a task into independent subtasks run in parallel.
//   - Voting: running the same task multiple times to get diverse outputs.
// This chapter combines both, mirroring Anthropic's own guardrails example:
// "one model instance processes user queries while another screens them for
// inappropriate content or requests. This tends to perform better than having
// the same LLM call handle both guardrails and the core response." The
// *answer* and *three independent guardrail reviewers* are sectioned off into
// separate, simultaneous LLM calls (Promise.all) — then the reviewers' votes
// are tallied (voting) to decide whether the already-generated answer is
// safe to reveal, or should be replaced with a refusal.

export const TAB = "parallelization";

export const runtime = "nodejs";

const ANSWER_SYSTEM_PROMPT =
  "You are a helpful, knowledgeable assistant. Use the web_search tool when a question needs current or up-to-date information, and cite sources when you do. Be concise and friendly.";

interface Voter {
  id: string;
  label: string;
  systemPrompt: string;
}

const VOTERS: Voter[] = [
  {
    id: "illegal",
    label: "Illegal activity",
    systemPrompt:
      "You are a content moderation reviewer. Decide whether the user's latest message is asking for help with illegal activity (e.g. weapons, drugs, fraud, unauthorized access). Respond `flag` if it is, `pass` if it's a legitimate request.",
  },
  {
    id: "self-harm",
    label: "Self-harm / dangerous content",
    systemPrompt:
      "You are a content moderation reviewer. Decide whether the user's latest message is requesting content that promotes self-harm, violence, or dangerous activities that could seriously injure someone. Respond `flag` if it is, `pass` if it's a legitimate request.",
  },
  {
    id: "malicious-code",
    label: "Malicious code / security exploits",
    systemPrompt:
      "You are a content moderation reviewer. Decide whether the user's latest message is asking for malware, viruses, or code intended to break into systems without authorization. Respond `flag` if it is, `pass` if it's a legitimate programming request.",
  },
];

// Majority vote out of VOTERS.length — a threshold, not a single reviewer's
// call, exactly per Anthropic's voting variation ("requiring different vote
// thresholds to balance false positives and negatives").
const VOTE_THRESHOLD = 2;

interface VoteResult {
  voter: Voter;
  flagged: boolean;
}

export async function POST(req: Request) {
  const body = await req.json();
  const { prompt, sessionId } = body as {
    prompt: string;
    sessionId?: string;
  };

  if (!prompt) {
    return new Response(JSON.stringify({ error: "prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "sessionId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return tracer.startActiveSpan(
    "parallelization.handleRequest",
    async (requestSpan) => {
      requestSpan.setAttribute("session.id", sessionId);
      requestSpan.setAttribute("prompt.length", prompt.length);

      const db = getDb();
      const messages = initChatSession(db, sessionId, TAB, prompt);

      let fullText = "";
      const emit = (writer: UIMessageStreamWriter, text: string) => {
        fullText += text;
        writer.write({ type: "text-delta", id: "main", delta: text });
      };

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          try {
            writer.write({ type: "text-start", id: "main" });

            // ── Sectioning: answer + every guardrail voter run in parallel ─
            const answerPromise = generateText({
              model: openai(DEFAULT_MODEL),
              system: ANSWER_SYSTEM_PROMPT,
              messages,
              stopWhen: stepCountIs(5),
              tools: { web_search: openai.tools.webSearch({}) },
              experimental_telemetry: {
                isEnabled: true,
                functionId: "parallelization-answer",
                metadata: { sessionId },
              },
            });

            const votePromises = VOTERS.map(
              async (voter): Promise<VoteResult> => {
                const result = await generateText({
                  model: openai(DEFAULT_MODEL),
                  system: voter.systemPrompt,
                  messages,
                  output: Output.choice({ options: ["flag", "pass"] }),
                  experimental_telemetry: {
                    isEnabled: true,
                    functionId: `parallelization-vote-${voter.id}`,
                    metadata: { sessionId },
                  },
                });
                return { voter, flagged: result.output === "flag" };
              },
            );

            const [answerResult, votes] = await Promise.all([
              answerPromise,
              Promise.all(votePromises),
            ]);

            // ── Voting: tally the independent reviewers' votes ────────────
            const flaggedBy = votes.filter((v) => v.flagged);
            const blocked = flaggedBy.length >= VOTE_THRESHOLD;

            requestSpan.setAttribute("voting.flag_count", flaggedBy.length);
            requestSpan.setAttribute("voting.threshold", VOTE_THRESHOLD);
            requestSpan.setAttribute("voting.blocked", blocked);
            requestSpan.setAttribute(
              "voting.flagged_by",
              flaggedBy.map((v) => v.voter.id).join(",") || "none",
            );

            const voteSummary = votes
              .map(
                (v) =>
                  `${v.flagged ? "🚩" : "✅"} ${v.voter.label}: ${v.flagged ? "flagged" : "passed"}`,
              )
              .join("\n");

            emit(
              writer,
              `🗳️ _Guardrail votes (${flaggedBy.length}/${VOTERS.length} flagged, threshold ${VOTE_THRESHOLD}):_\n${voteSummary}\n\n---\n\n`,
            );

            // ── Reveal the answer only if it cleared the vote ─────────────
            if (blocked) {
              emit(
                writer,
                `🚫 This request was flagged by ${flaggedBy.length} of ${VOTERS.length} independent reviewers (${flaggedBy.map((v) => v.voter.label).join(", ")}), so I can't help with it. If you think this was a mistake, try rephrasing your request.`,
              );
            } else {
              emit(writer, answerResult.text);
            }

            writer.write({ type: "text-end", id: "main" });

            saveAssistantMessage(db, sessionId, fullText);
            requestSpan.setAttribute("response.length", fullText.length);
            requestSpan.setStatus({ code: SpanStatusCode.OK });
          } catch (err) {
            requestSpan.recordException(err as Error);
            requestSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
          } finally {
            requestSpan.end();
          }
        },
      });

      return createUIMessageStreamResponse({ stream });
    },
  );
}
