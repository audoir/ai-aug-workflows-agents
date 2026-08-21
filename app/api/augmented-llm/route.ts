import { openai } from "@ai-sdk/openai";
import { streamText, stepCountIs, tool } from "ai";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { getDb } from "@/lib/db";
import { initChatSession, saveAssistantMessage } from "@/lib/chat-session";
import {
  jsSandboxInputSchema,
  runJavaScript,
  JS_SANDBOX_TOOL_DESCRIPTION,
} from "@/lib/js-sandbox";
import { DEFAULT_MODEL } from "@/lib/config";

const tracer = trace.getTracer("ai-aug-workflows-agents");

// One row per tool call made anywhere across the turn — surfaced on the
// request span so every web_search / execute_javascript invocation (input
// and output) is visible in Jaeger without having to open each individual
// ai.toolCall span.
interface ToolUseRecord {
  toolName: string;
  input: unknown;
  output: unknown;
}

// ─── Building block: The augmented LLM ────────────────────────────────────────
// A single LLM call augmented with three capabilities:
//   - retrieval, via OpenAI's built-in web search tool
//   - a local JavaScript code execution sandbox, for math/data/logic tasks
//   - memory, via chat history persisted per-session in an in-memory SQLite DB
// There's no custom orchestration logic here — the model decides on its own
// when a query needs the web or needs code execution, and calls the
// appropriate tool itself.

export const TAB = "augmented-llm";

export const runtime = "nodejs";

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
    "augmented-llm.handleRequest",
    async (requestSpan) => {
      requestSpan.setAttribute("session.id", sessionId);
      requestSpan.setAttribute("prompt.length", prompt.length);

      try {
        const db = getDb();
        const messages = initChatSession(db, sessionId, TAB, prompt);

        const result = streamText({
          model: openai(DEFAULT_MODEL),
          system:
            "You are a helpful AI assistant. Use the web_search tool when a question needs current or up-to-date information, and cite sources when you do. Use the execute_javascript tool for math, data processing, or any logic that's more reliable to compute in code than in your head — always console.log() the final answer so you can see it. Be concise and friendly in your responses.",
          messages,
          stopWhen: stepCountIs(5),
          experimental_telemetry: {
            isEnabled: true,
            functionId: "augmented-llm-agent",
            metadata: { sessionId },
          },
          tools: {
            web_search: openai.tools.webSearch({}),
            execute_javascript: tool({
              description: JS_SANDBOX_TOOL_DESCRIPTION,
              inputSchema: jsSandboxInputSchema,
              execute: async ({ code }) => runJavaScript(code),
            }),
          },
          onFinish: async ({ text, steps }) => {
            saveAssistantMessage(db, sessionId, text);
            requestSpan.setAttribute("response.length", text.length);

            // Surface every web_search / execute_javascript call made across
            // all steps of this turn
            const toolUses: ToolUseRecord[] = steps.flatMap((step) =>
              step.toolResults.map((result) => ({
                toolName: result.toolName,
                input: result.input,
                output: result.output,
              })),
            );
            requestSpan.setAttribute("agent.tool_uses.count", toolUses.length);
            requestSpan.setAttribute(
              "agent.tool_uses",
              JSON.stringify(toolUses),
            );

            requestSpan.setStatus({ code: SpanStatusCode.OK });
            requestSpan.end();
          },
        });

        return result.toUIMessageStreamResponse();
      } catch (err) {
        requestSpan.recordException(err as Error);
        requestSpan.setStatus({ code: SpanStatusCode.ERROR });
        requestSpan.end();
        throw err;
      }
    },
  );
}
