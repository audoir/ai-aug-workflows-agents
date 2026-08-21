import { openai } from "@ai-sdk/openai";
import {
  generateText,
  streamText,
  stepCountIs,
  Output,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import { z } from "zod";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { getDb } from "@/lib/db";
import { initChatSession, saveAssistantMessage } from "@/lib/chat-session";
import { DEFAULT_MODEL } from "@/lib/config";

const tracer = trace.getTracer("ai-aug-workflows-agents");

// ─── Workflow: Evaluator-optimizer ─────────────────────────────────────────────
// Anthropic's example: "Complex search tasks that require multiple rounds of
// searching and analysis to gather comprehensive information, where the
// evaluator decides whether further searches are warranted." One LLM call
// generates (searches), another evaluates the result and decides whether to
// loop again — the loop, not a fixed step count, is what makes this pattern
// distinct from prompt chaining's one-shot gate (Chapter 2).
//
//   1. Searcher: a generateText call with web_search researches the question,
//      building on findings from any prior round.
//   2. Evaluator: a generateText call with structured output judges whether
//      the accumulated findings are comprehensive enough, or whether another
//      round of searching (on a specific gap) is warranted.
//   3. Loop steps 1-2 until the evaluator is satisfied or MAX_ROUNDS is hit —
//      then a final streamText call writes the answer from all findings.

export const TAB = "evaluator-optimizer";

export const runtime = "nodejs";

const MAX_ROUNDS = 3;

// `nextQuery` is nullable (not optional) because OpenAI's strict structured
// output mode requires every property to appear in the schema's `required`
// array — a truly optional key (which zod's `.optional()` drops from
// `required`) isn't supported. Nullable keeps the key required while still
// letting the model signal "no follow-up query" via `null`.
const evaluationSchema = z.object({
  sufficient: z
    .boolean()
    .describe("Whether the findings so far comprehensively answer the question"),
  reasoning: z.string().describe("Brief explanation of the judgment"),
  nextQuery: z
    .string()
    .nullable()
    .describe(
      "If not sufficient, the specific, focused follow-up search needed to fill the biggest gap. Null if sufficient.",
    ),
});

const SEARCHER_SYSTEM_PROMPT =
  "You are a research assistant. Use the web_search tool to investigate the given query and report your findings concisely, with sources. If prior findings are provided, don't repeat them — focus on filling in what's missing.";

const EVALUATOR_SYSTEM_PROMPT =
  "You are a meticulous research evaluator. Given the original question and the findings gathered so far, decide whether they comprehensively and accurately answer the question, or whether a further round of searching is warranted. Be strict: only mark findings sufficient once they cover the question's important angles with concrete, sourced information — not just a first pass. If insufficient, specify one focused follow-up search query targeting the single biggest remaining gap.";

const ANSWER_SYSTEM_PROMPT =
  "You are an expert analyst. Write a clear, comprehensive answer to the original question, drawing on all the findings gathered across every research round. Organize with markdown headings where useful, and don't mention the research process itself — just answer the question.";

interface Round {
  query: string;
  findings: string;
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
    "evaluator-optimizer.handleRequest",
    async (requestSpan) => {
      requestSpan.setAttribute("session.id", sessionId);
      requestSpan.setAttribute("prompt.length", prompt.length);

      const db = getDb();
      initChatSession(db, sessionId, TAB, prompt);

      let fullText = "";
      const emit = (writer: UIMessageStreamWriter, text: string) => {
        fullText += text;
        writer.write({ type: "text-delta", id: "main", delta: text });
      };

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          try {
            writer.write({ type: "text-start", id: "main" });

            const rounds: Round[] = [];
            let round = 1;
            let query = prompt;

            // ── Searcher ⇄ Evaluator loop ──────────────────────────────────
            while (round <= MAX_ROUNDS) {
              emit(writer, `### 🔎 Round ${round} — Searching\n\n_Query: ${query}_\n\n`);

              const priorFindings = rounds
                .map((r, i) => `Round ${i + 1} (${r.query}):\n${r.findings}`)
                .join("\n\n");

              const searchResult = await generateText({
                model: openai(DEFAULT_MODEL),
                system: SEARCHER_SYSTEM_PROMPT,
                prompt: priorFindings
                  ? `Original question: ${prompt}\n\nPrior findings:\n${priorFindings}\n\nCurrent search query: ${query}`
                  : `Original question: ${prompt}\n\nCurrent search query: ${query}`,
                stopWhen: stepCountIs(5),
                tools: { web_search: openai.tools.webSearch({}) },
                experimental_telemetry: {
                  isEnabled: true,
                  functionId: `evaluator-optimizer-search-round-${round}`,
                  metadata: { sessionId, round },
                },
              });

              const findings = searchResult.text.trim();
              rounds.push({ query, findings });
              emit(writer, `${findings}\n\n`);

              emit(writer, `### 🧑‍⚖️ Round ${round} — Evaluating\n\n`);

              const evaluation = await generateText({
                model: openai(DEFAULT_MODEL),
                system: EVALUATOR_SYSTEM_PROMPT,
                prompt: `Original question: ${prompt}\n\nFindings gathered so far:\n${rounds
                  .map((r, i) => `Round ${i + 1} (${r.query}):\n${r.findings}`)
                  .join("\n\n")}`,
                output: Output.object({ schema: evaluationSchema }),
                experimental_telemetry: {
                  isEnabled: true,
                  functionId: `evaluator-optimizer-evaluate-round-${round}`,
                  metadata: { sessionId, round },
                },
              });

              const verdict = evaluation.output;
              requestSpan.setAttribute(
                `evaluator.round_${round}.sufficient`,
                verdict.sufficient,
              );

              if (verdict.sufficient) {
                emit(writer, `✅ _Sufficient — ${verdict.reasoning}_\n\n---\n\n`);
                break;
              }

              if (round >= MAX_ROUNDS) {
                emit(
                  writer,
                  `⚠️ _Not fully sufficient (${verdict.reasoning}), but reached the ${MAX_ROUNDS}-round limit — answering with what we have._\n\n---\n\n`,
                );
                break;
              }

              const nextQuery = verdict.nextQuery ?? prompt;
              emit(
                writer,
                `🔁 _Not sufficient — ${verdict.reasoning}_\n_Next query: ${nextQuery}_\n\n---\n\n`,
              );
              query = nextQuery;
              round += 1;
            }

            requestSpan.setAttribute("evaluator.rounds_used", rounds.length);

            // ── Final answer, synthesized from every round's findings ──────
            emit(writer, `### 📄 Final Answer\n\n`);

            const answerResult = streamText({
              model: openai(DEFAULT_MODEL),
              system: ANSWER_SYSTEM_PROMPT,
              prompt: `Original question: ${prompt}\n\nFindings gathered across ${rounds.length} round(s):\n${rounds
                .map((r, i) => `Round ${i + 1} (${r.query}):\n${r.findings}`)
                .join("\n\n")}`,
              stopWhen: stepCountIs(1),
              experimental_telemetry: {
                isEnabled: true,
                functionId: "evaluator-optimizer-answer",
                metadata: { sessionId },
              },
            });

            for await (const delta of answerResult.textStream) {
              emit(writer, delta);
            }
            await answerResult.text;

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