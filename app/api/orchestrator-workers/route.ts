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

// ─── Workflow: Orchestrator-workers ────────────────────────────────────────────
// Anthropic's example: "Search tasks that involve gathering and analyzing
// information from multiple sources for possible relevant information." The
// key difference from parallelization (Chapter 4) is flexibility: subtasks
// aren't pre-defined — a central orchestrator LLM call decides, per question,
// how many worker subtasks are needed and what each should investigate.
//
//   1. Orchestrator: one generateText call with structured output plans a
//      small set of research subtasks for the user's question (2-4, each
//      with its own focused sub-question) — this plan is *dynamic*, unlike
//      parallelization's fixed voter list.
//   2. Workers: every planned subtask runs as its own generateText call with
//      web_search, in parallel (Promise.all) — each worker only researches
//      its one assigned sub-question and reports findings with sources.
//   3. Synthesizer: one streamText call combines every worker's findings
//      into a single coherent report, streamed back to the browser.

export const TAB = "orchestrator-workers";

export const runtime = "nodejs";

const MIN_SUBTASKS = 2;
const MAX_SUBTASKS = 4;

const planSchema = z.object({
  subtasks: z
    .array(
      z.object({
        title: z.string().describe("A short (3-6 word) label for this subtask"),
        query: z
          .string()
          .describe(
            "The specific, focused research question this worker should investigate",
          ),
      }),
    )
    .min(MIN_SUBTASKS)
    .max(MAX_SUBTASKS),
});

const ORCHESTRATOR_SYSTEM_PROMPT = `You are a research orchestrator. Given a research question, break it down into ${MIN_SUBTASKS}-${MAX_SUBTASKS} independent subtasks that, together, cover the question well — each subtask should be answerable on its own by researching a different angle or source, without needing the others' results first. Don't over-split simple questions; use the minimum number of subtasks that gives good coverage.`;

const WORKER_SYSTEM_PROMPT =
  "You are a research assistant investigating one focused sub-question as part of a larger research task. Use the web_search tool to find relevant, current information, and cite your sources. Report your findings concisely — a few sentences to a short paragraph — focused only on your assigned sub-question.";

const SYNTHESIZER_SYSTEM_PROMPT =
  "You are a research analyst. You've been given a research question and a set of findings gathered independently by different researchers on different sub-questions. Synthesize them into one clear, well-organized report that directly answers the original question, reconciling or noting any disagreements between findings. Use markdown with a short heading per theme where useful.";

interface WorkerResult {
  title: string;
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
    "orchestrator-workers.handleRequest",
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

            // ── Step 1: orchestrator plans the subtasks dynamically ────────
            emit(writer, `### 🧭 Step 1 — Orchestrator's Plan\n\n`);

            const planResult = await generateText({
              model: openai(DEFAULT_MODEL),
              system: ORCHESTRATOR_SYSTEM_PROMPT,
              prompt: `Research question: ${prompt}`,
              output: Output.object({ schema: planSchema }),
              experimental_telemetry: {
                isEnabled: true,
                functionId: "orchestrator-plan",
                metadata: { sessionId },
              },
            });

            const subtasks = planResult.output.subtasks;
            requestSpan.setAttribute("orchestrator.subtask_count", subtasks.length);
            requestSpan.setAttribute(
              "orchestrator.subtasks",
              JSON.stringify(subtasks),
            );

            emit(
              writer,
              `Broke this into ${subtasks.length} subtask(s):\n${subtasks
                .map((s, i) => `${i + 1}. **${s.title}** — ${s.query}`)
                .join("\n")}\n\n---\n\n`,
            );

            // ── Step 2: workers investigate every subtask in parallel ──────
            emit(writer, `### 🔎 Step 2 — Workers Researching in Parallel\n\n`);

            const workerResults: WorkerResult[] = await Promise.all(
              subtasks.map(async (subtask): Promise<WorkerResult> => {
                const result = await generateText({
                  model: openai(DEFAULT_MODEL),
                  system: WORKER_SYSTEM_PROMPT,
                  prompt: `Sub-question: ${subtask.query}`,
                  stopWhen: stepCountIs(5),
                  tools: { web_search: openai.tools.webSearch({}) },
                  experimental_telemetry: {
                    isEnabled: true,
                    functionId: `orchestrator-worker-${subtask.title}`,
                    metadata: { sessionId },
                  },
                });
                return {
                  title: subtask.title,
                  query: subtask.query,
                  findings: result.text.trim(),
                };
              }),
            );

            for (const w of workerResults) {
              emit(writer, `**${w.title}**\n${w.findings}\n\n`);
            }
            emit(writer, `---\n\n`);

            // ── Step 3: synthesize every worker's findings into one report ─
            emit(writer, `### 📋 Step 3 — Synthesized Report\n\n`);

            const synthesisResult = streamText({
              model: openai(DEFAULT_MODEL),
              system: SYNTHESIZER_SYSTEM_PROMPT,
              prompt: `Original research question: ${prompt}\n\nFindings gathered by independent workers:\n${workerResults
                .map((w) => `### ${w.title} (${w.query})\n${w.findings}`)
                .join("\n\n")}`,
              stopWhen: stepCountIs(1),
              experimental_telemetry: {
                isEnabled: true,
                functionId: "orchestrator-synthesis",
                metadata: { sessionId },
              },
            });

            for await (const delta of synthesisResult.textStream) {
              emit(writer, delta);
            }
            await synthesisResult.text;

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
