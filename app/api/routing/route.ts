import { openai } from "@ai-sdk/openai";
import {
  generateText,
  streamText,
  stepCountIs,
  tool,
  Output,
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
} from "@/lib/js-sandbox";
import { DEFAULT_MODEL } from "@/lib/config";

const tracer = trace.getTracer("ai-aug-workflows-agents");

// ─── Workflow: Routing ─────────────────────────────────────────────────────────
// Anthropic's example: "Directing different types of customer service queries
// (general questions, refund requests, technical support) into different
// downstream processes, prompts, and tools." A cheap classification step
// picks exactly one category, and the rest of the turn runs with a
// specialized system prompt and tool set for that category — rather than one
// generic prompt trying to handle every kind of query well.
//
//   1. Classify the customer's message into general / refund / technical
//      using generateText's `output: Output.choice(...)`, a fast, cheap
//      structured-output call — no free-form parsing needed.
//   2. Route to that category's system prompt and tools:
//        - general   → web_search   (product/account questions, may need current info)
//        - refund    → execute_javascript (computes a precise, auditable refund amount)
//        - technical → web_search   (troubleshooting, may need current docs/known issues)
//   3. Stream the specialized response back, with a small banner announcing
//      which category the message was routed to (Anthropic's "transparency"
//      principle — show the routing decision, don't hide it).

export const TAB = "routing";

export const runtime = "nodejs";

const CATEGORIES = ["general", "refund", "technical"] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_META: Record<Category, { label: string; icon: string }> = {
  general: { label: "General question", icon: "💬" },
  refund: { label: "Refund request", icon: "💰" },
  technical: { label: "Technical support", icon: "🛠️" },
};

const CLASSIFIER_SYSTEM_PROMPT =
  "You are a customer support triage classifier for a software subscription company. Classify the customer's latest message into exactly one category: `general` for general account, billing, or product questions and how-tos; `refund` for refund, cancellation, or billing-dispute requests; `technical` for bug reports, errors, or troubleshooting. Pick the single best-fitting category based on the whole conversation, weighted toward the most recent message.";

const SYSTEM_PROMPTS: Record<Category, string> = {
  general:
    "You are a friendly, knowledgeable customer support agent for a software subscription company, answering general account, billing, and product questions. Use the web_search tool if the question needs current or product-specific information you're not certain of. Be concise and helpful.",
  refund:
    "You are a customer support agent processing a refund request for a software subscription company. Refund policy: refunds are pro-rated based on days remaining in a 30-day billing cycle (refundAmount = (daysRemaining / 30) * monthlyFee, rounded to 2 decimals). Use the execute_javascript tool to compute the exact refund amount whenever the customer gives you a monthly fee and either a billing date or days remaining — console.log the result. Show your computed number and briefly explain the policy. If you don't have enough information (monthly fee, billing date) to compute a number, ask for it.",
  technical:
    "You are a technical support engineer for a software subscription company, helping troubleshoot bugs and errors. Use the web_search tool to look up current known issues, error messages, or documentation when it would help. Be precise and give concrete troubleshooting steps.",
};

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
    "routing.handleRequest",
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

            // ── Step 1: classify ────────────────────────────────────────
            const classification = await generateText({
              model: openai(DEFAULT_MODEL),
              system: CLASSIFIER_SYSTEM_PROMPT,
              messages,
              output: Output.choice({ options: [...CATEGORIES] }),
              experimental_telemetry: {
                isEnabled: true,
                functionId: "routing-classifier",
                metadata: { sessionId },
              },
            });
            const category = classification.output;
            const meta = CATEGORY_META[category];

            requestSpan.setAttribute("routing.category", category);
            emit(
              writer,
              `${meta.icon} _Routed to: **${meta.label}**_\n\n---\n\n`,
            );

            // ── Step 2: respond with the category's prompt + tools ──────
            const refundTools = {
              execute_javascript: tool({
                description: JS_SANDBOX_TOOL_DESCRIPTION,
                inputSchema: jsSandboxInputSchema,
                execute: async ({ code }) => runJavaScript(code),
              }),
            };
            const searchTools = { web_search: openai.tools.webSearch({}) };
            const tools: typeof refundTools | typeof searchTools =
              category === "refund" ? refundTools : searchTools;

            const responseResult = streamText({
              model: openai(DEFAULT_MODEL),
              system: SYSTEM_PROMPTS[category],
              messages,
              stopWhen: stepCountIs(5),
              tools,
              experimental_telemetry: {
                isEnabled: true,
                functionId: `routing-response-${category}`,
                metadata: { sessionId },
              },
            });

            for await (const delta of responseResult.textStream) {
              emit(writer, delta);
            }
            await responseResult.text;

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
