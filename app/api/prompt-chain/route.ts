import { openai } from "@ai-sdk/openai";
import {
  generateText,
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { getDb } from "@/lib/db";
import { initChatSession, saveAssistantMessage } from "@/lib/chat-session";
import { evaluateGate, formatGateSummary } from "@/lib/prompt-chain";
import { DEFAULT_MODEL } from "@/lib/config";

const tracer = trace.getTracer("ai-aug-workflows-agents");

// ─── Workflow: Prompt chaining ────────────────────────────────────────────────
// Anthropic's example: "Writing an outline of a document, checking that the
// outline meets certain criteria, then writing the document based on the
// outline." This route decomposes that into three fixed, predefined steps —
// no model decides what happens next, the code path does:
//
//   1. LLM call #1 drafts an outline for the user's topic, using web_search
//      to ground it in current/factual information when helpful.
//   2. A programmatic GATE (lib/prompt-chain.ts) inspects the outline —
//      section count, word count, leftover placeholder text — using plain,
//      deterministic TypeScript (no LLM call). If it fails, the outline is
//      sent back to the LLM for one revision pass with the specific gate
//      feedback attached.
//   3. LLM call #2 writes the full document from the gate-approved outline,
//      streamed token-by-token back to the browser.
//
// Each step's output is streamed to the client as it completes, so the whole
// chain — outline, gate verdict, final document — is visible in real time.

export const TAB = "prompt-chaining";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 2;

const OUTLINE_SYSTEM_PROMPT =
  "You are an expert technical writer. Use the web_search tool to research the topic first if current, factual, or up-to-date information would make the outline stronger, and cite sources inline where relevant. Then produce a clear outline for a short document on the topic, using markdown headings (##) for each of at least 3 sections, each followed by 1-2 sentences describing what that section will cover. Every section must have real, specific content described — never use placeholder text like TBD, TODO, or [insert ...]. Keep the entire outline under 400 words.";

const OUTLINE_REVISION_SYSTEM_PROMPT =
  "You are an expert technical writer revising an outline based on automated feedback. Use the web_search tool if more research would help fix the issues. Address every issue listed, and return the complete revised outline using the same markdown heading format (## per section) — do not include commentary about the changes, just the corrected outline.";

const DOCUMENT_SYSTEM_PROMPT =
  "You are an expert writer. Write a complete, polished document in markdown that fully develops the provided outline, section by section, in the same order. Write full prose for each section — do not just restate the outline bullet points. Be clear and engaging.";

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
    "prompt-chain.handleRequest",
    async (requestSpan) => {
      requestSpan.setAttribute("session.id", sessionId);
      requestSpan.setAttribute("prompt.length", prompt.length);

      const db = getDb();
      // The chain only needs the current topic to run each step — unlike the
      // augmented LLM, prior turns aren't fed back into the model — but we
      // still record this turn in the same session store so it shows up in
      // Previous Chats and can be resumed.
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

            // ── Step 1: draft the outline ────────────────────────────────
            emit(
              writer,
              `### 📝 Step 1 — Outline\n\n_Researching and outlining:_ **${prompt}**\n\n`,
            );

            const outlineResult = await generateText({
              model: openai(DEFAULT_MODEL),
              system: OUTLINE_SYSTEM_PROMPT,
              prompt: `Write an outline for a short document about: ${prompt}`,
              stopWhen: stepCountIs(3),
              experimental_telemetry: {
                isEnabled: true,
                functionId: "prompt-chain-outline",
                metadata: { sessionId },
              },
              tools: { web_search: openai.tools.webSearch({}) },
            });

            let outline = outlineResult.text.trim();
            emit(writer, `${outline}\n\n`);

            // ── Step 2: programmatic gate check (plain code) ─────────────
            emit(writer, `### 🚦 Step 2 — Gate Check\n\n`);

            let attempt = 1;
            let gate = evaluateGate(outline);
            emit(writer, `${formatGateSummary(attempt, gate)}\n\n`);
            requestSpan.setAttribute(
              `gate.attempt_${attempt}.passed`,
              gate.passed,
            );

            while (!gate.passed && attempt < MAX_ATTEMPTS) {
              attempt += 1;
              emit(
                writer,
                `_Sending the outline back to the model for revision (attempt ${attempt}/${MAX_ATTEMPTS})..._\n\n`,
              );

              const revision = await generateText({
                model: openai(DEFAULT_MODEL),
                system: OUTLINE_REVISION_SYSTEM_PROMPT,
                prompt: `Revise this outline to fix the following issues:\n${gate.issues.map((i) => `- ${i}`).join("\n")}\n\nOriginal outline:\n${outline}`,
                stopWhen: stepCountIs(3),
                experimental_telemetry: {
                  isEnabled: true,
                  functionId: "prompt-chain-outline-revision",
                  metadata: { sessionId, attempt },
                },
                tools: { web_search: openai.tools.webSearch({}) },
              });

              outline = revision.text.trim();
              emit(writer, `${outline}\n\n`);

              gate = evaluateGate(outline);
              emit(writer, `${formatGateSummary(attempt, gate)}\n\n`);
              requestSpan.setAttribute(
                `gate.attempt_${attempt}.passed`,
                gate.passed,
              );
            }

            requestSpan.setAttribute("gate.final_passed", gate.passed);
            requestSpan.setAttribute("gate.attempts", attempt);

            // ── Step 3: write the full document from the approved outline ─
            emit(writer, `### 📄 Step 3 — Final Document\n\n`);

            const docResult = streamText({
              model: openai(DEFAULT_MODEL),
              system: DOCUMENT_SYSTEM_PROMPT,
              prompt: `Write the full document based on this outline:\n\n${outline}`,
              stopWhen: stepCountIs(1),
              experimental_telemetry: {
                isEnabled: true,
                functionId: "prompt-chain-document",
                metadata: { sessionId },
              },
            });

            for await (const delta of docResult.textStream) {
              emit(writer, delta);
            }
            // Make sure this step is fully settled before closing the span.
            await docResult.text;

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
