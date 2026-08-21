import { openai } from "@ai-sdk/openai";
import {
  streamText,
  stepCountIs,
  tool,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { getDb } from "@/lib/db";
import { initChatSession, saveAssistantMessage } from "@/lib/chat-session";
import {
  jsSandboxInputSchema,
  runJavaScript,
  JS_SANDBOX_TOOL_DESCRIPTION,
  type JsSandboxInput,
  type JsSandboxResult,
} from "@/lib/js-sandbox";
import { DEFAULT_MODEL } from "@/lib/config";

const tracer = trace.getTracer("ai-aug-workflows-agents");

// ─── Agents ─────────────────────────────────────────────────────────────────────
// Every prior tab in this app is a *workflow*: the code decides the sequence
// of steps (outline → gate → document; classify → respond; search → evaluate
// → repeat). This tab is an *agent* in Anthropic's sense — there's no
// predefined path at all. The model itself decides, turn by turn, whether to
// write code, run it, read the real pass/fail result, fix its own mistakes,
// try again, or declare itself done. The only thing the code fixes in
// advance is a safety cap (`stopWhen: stepCountIs(MAX_STEPS)`), not a plan.
//
// This mirrors Anthropic's own primary example — a coding agent resolving
// SWE-bench-style tasks — in miniature: give it a coding task with test
// cases, and let it use execute_javascript to write a solution, test it, and
// iterate on real execution output ("ground truth from the environment")
// until every test passes or it runs out of attempts.

export const TAB = "agent";

export const runtime = "nodejs";

const MAX_STEPS = 10;

const AGENT_SYSTEM_PROMPT = `You are an autonomous coding agent. You'll be given a coding task with test cases. Solve it by:
1. Writing a JavaScript solution and testing it yourself with the execute_javascript tool — write code that runs your function against every provided test case and console.log()s each one's expected vs. actual result (e.g. "Test 1: expected X, got Y — PASS/FAIL").
2. Reading the actual output of your test run. Trust it over your own assumptions — if a test fails, figure out why from the real output, fix your solution, and run it again.
3. Repeating until every test case passes, or you're confident further attempts won't help.
4. Once done, reply with a final message containing the working solution code and a one-line summary of how many attempts it took.

Do not just claim tests pass without actually running them and reading the real output. You decide how many attempts you need — there's no fixed number.`;

interface ToolUseRecord {
  attempt: number;
  code: string;
  success: boolean;
  logs?: string;
  error?: string;
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

  return tracer.startActiveSpan("agent.handleRequest", async (requestSpan) => {
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

          const toolUses: ToolUseRecord[] = [];
          let attempt = 0;

          const result = streamText({
            model: openai(DEFAULT_MODEL),
            system: AGENT_SYSTEM_PROMPT,
            prompt: `Coding task:\n${prompt}`,
            // The safety cap — the only thing bounding this agent in advance.
            // Everything else (whether to write code, run it, retry, or stop)
            // is the model's own decision, turn by turn.
            stopWhen: stepCountIs(MAX_STEPS),
            tools: {
              execute_javascript: tool({
                description: JS_SANDBOX_TOOL_DESCRIPTION,
                inputSchema: jsSandboxInputSchema,
                execute: async ({ code }) => runJavaScript(code),
              }),
            },
            experimental_telemetry: {
              isEnabled: true,
              functionId: "agent-coding-loop",
              metadata: { sessionId },
            },
          });

          // Stream every part of the agent's own tool-use loop live, rather
          // than only the final answer — this is what makes the agent's
          // decision-making visible (Anthropic's "transparency" principle),
          // since unlike a workflow, the code has no plan to show in advance.
          for await (const part of result.fullStream) {
            if (part.type === "tool-call" && part.toolName === "execute_javascript") {
              attempt += 1;
              const input = part.input as JsSandboxInput;
              emit(
                writer,
                `### 🛠️ Attempt ${attempt} — Writing & Running Code\n\n\`\`\`javascript\n${input.code}\n\`\`\`\n\n`,
              );
            } else if (
              part.type === "tool-result" &&
              part.toolName === "execute_javascript"
            ) {
              const input = part.input as JsSandboxInput;
              const res = part.output as JsSandboxResult;
              toolUses.push({
                attempt,
                code: input.code,
                success: res.success,
                logs: res.logs,
                error: res.error,
              });
              emit(
                writer,
                res.success
                  ? `**Output:**\n\`\`\`\n${res.logs || "(no output)"}\n\`\`\`\n\n---\n\n`
                  : `**Error:**\n\`\`\`\n${res.error}\n\`\`\`\n\n---\n\n`,
              );
            } else if (part.type === "text-delta") {
              emit(writer, part.text);
            }
          }

          writer.write({ type: "text-end", id: "main" });

          saveAssistantMessage(db, sessionId, fullText);
          requestSpan.setAttribute("response.length", fullText.length);
          requestSpan.setAttribute("agent.attempts", attempt);
          requestSpan.setAttribute("agent.tool_uses", JSON.stringify(toolUses));
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
  });
}
