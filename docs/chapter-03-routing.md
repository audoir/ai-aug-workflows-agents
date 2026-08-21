# Chapter 3 — Workflow: Routing

## What is Routing?

**Routing** classifies an input and directs it to a specialized downstream process — its own prompt, and often its own tools — rather than asking one generic prompt to handle every kind of request well. It's a separation-of-concerns pattern: a cheap classification step up front lets each specialized path stay simple and focused.

> "Routing classifies an input and directs it to a specialized followup task. This workflow allows for separation of concerns, and building more specialized prompts. Without this workflow, optimizing for one kind of input can hurt performance on other inputs."

This chapter implements Anthropic's own customer-service example:

> "Directing different types of customer service queries (general questions, refund requests, technical support) into different downstream processes, prompts, and tools."

---

## The Two Steps (This Chapter)

| Step | Implementation | Purpose |
|------|-----------------|---------|
| 1. 🚦 **Classify** | `generateText` call with `output: Output.choice(...)` (`app/api/routing/route.ts`) | Picks exactly one category — `general`, `refund`, or `technical` — from the conversation, as cheap structured output rather than free-form text to parse |
| 2. 💬 **Respond** | `streamText` call, streamed token-by-token to the browser | Answers using that category's own system prompt *and* tool set |

Unlike Chapter 2's prompt chaining, this isn't a fixed sequence toward one final artifact — it's a fork in the road: the same two-step shape runs every turn, but *which* prompt and tools it uses depends on the classification.

---

## The Three Routes

| Category | System Prompt Focus | Tool | Why |
|----------|---------------------|------|-----|
| 💬 `general` | Friendly answers to account/billing/product questions | `web_search` | May need current or product-specific info the model isn't certain of |
| 💰 `refund` | Applies a fixed pro-ration policy | `execute_javascript` | A refund amount should be computed precisely and reproducibly, not estimated in prose |
| 🛠️ `technical` | Troubleshooting bugs and errors | `web_search` | May need to look up known issues or current documentation |

Each category gets a *different* tool, not just a different prompt — reusing both augmentations from Chapter 1 (`web_search`, `execute_javascript`), routed to whichever one actually fits the task.

---

## When to Use This Pattern

- Inputs fall into a small number of distinct categories that are better handled by separate, specialized prompts than one prompt trying to do everything.
- Classification itself is easy and cheap — a single structured-output call, not something that needs deep reasoning.
- Optimizing a shared prompt for one category tends to hurt its performance on the others (Anthropic's stated motivation) — e.g. a refund prompt heavy on policy language reads oddly when answering a "how do I change my email" question.

---

## Architecture (This Chapter)

```
User message
    ↓
POST /api/routing  { prompt, sessionId }
    ↓
Step 1: generateText({ output: Output.choice([...]) })  — classify into general / refund / technical
    ↓
Step 2: pick that category's SYSTEM_PROMPTS[category] + tools
    │
    ├── general   → web_search
    ├── refund    → execute_javascript
    └── technical → web_search
    ↓
streamText()  — specialized response, streamed to the browser
    ↓
Assistant reply (routing banner + response) saved to SQLite for this session
```

A small banner — `💰 _Routed to: **Refund request**_` — is streamed before the response itself, so the routing decision is always visible rather than hidden inside the model's reasoning (Anthropic's "transparency" principle: explicitly show the agent's planning steps).

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/routing/route.ts` | Both steps: classify, then respond with the matching prompt and tools |
| `app/components/Routing.tsx` | Chat UI for this tab — multi-turn, using the same `useCompletion` pattern as Chapter 1, since customer support is naturally a back-and-forth conversation (unlike Chapter 2's single-shot workflow) |
| `lib/js-sandbox.ts` | The same sandboxed `execute_javascript` tool from Chapter 1, reused here for the `refund` category's pro-ration math |

---

## The Route, Step by Step

```ts
// app/api/routing/route.ts
const classification = await generateText({
  model: openai(DEFAULT_MODEL),
  system: CLASSIFIER_SYSTEM_PROMPT,
  messages,
  output: Output.choice({ options: ["general", "refund", "technical"] }),
});
const category = classification.output; // "general" | "refund" | "technical"

const refundTools = { execute_javascript: tool({ /* ... */ }) };
const searchTools = { web_search: openai.tools.webSearch({}) };
const tools = category === "refund" ? refundTools : searchTools;

const responseResult = streamText({
  model: openai(DEFAULT_MODEL),
  system: SYSTEM_PROMPTS[category],
  messages,
  tools,
});

for await (const delta of responseResult.textStream) {
  // streamed to the browser via createUIMessageStream's writer
}
```

**Key points:**
- `Output.choice({ options: [...] })` is the Vercel AI SDK's structured-output helper for picking exactly one value from a fixed list — the classifier can't return anything outside `general` / `refund` / `technical`, so there's no free-form text to parse or validate.
- Classification runs against the *full conversation history* (`messages`, loaded the same way as Chapter 1's memory), not just the latest message — a follow-up like "actually, never mind, how do I update my email?" should reclassify correctly rather than getting stuck in the first category.
- Just like Chapter 2, `streamText`/`generateText` calls aren't natively composable into one UI message stream, so the route uses `createUIMessageStream` + a small `emit()` helper to push the routing banner and then every response `text-delta` into a single streamed assistant message.
- Each step opts into `experimental_telemetry` with its own `functionId` (`routing-classifier`, `routing-response-{category}`), and the chosen category is recorded as a span attribute (`routing.category`), so which path a turn took is inspectable in Jaeger.
- The refund system prompt hardcodes the pro-ration formula in the prompt itself (`refundAmount = (daysRemaining / 30) * monthlyFee`) and tells the model to compute it via `execute_javascript` rather than doing the arithmetic in its head — the same "code is more reliable than reasoning for math" principle from Chapter 1's augmented LLM.

---

## What Happens When You Send a Message

For the message *"I was charged $29 on the 10th of a 30-day cycle and want to cancel — how much can I get back?"*:

1. **Browser** → `POST /api/routing` `{ prompt, sessionId }`
2. **Step 1**: `generateText` with `Output.choice` classifies this as `refund`
3. A banner streams first: `💰 _Routed to: **Refund request**_`
4. **Step 2**: `streamText` runs with the `refund` system prompt and only the `execute_javascript` tool available — it calls the tool with code computing `(20 / 30) * 29`, reads back the console.log'd result, and explains the pro-rated refund amount
5. The complete text (banner + response) is saved to SQLite as the assistant's reply, so it shows up in **Previous Chats** and can be resumed

Send *"The app keeps crashing whenever I try to export a report"* in a fresh session instead, and the same two steps run, but land on `technical` with only `web_search` available — the model can look up known issues rather than compute anything.

---

> **Next Steps:**
> More chapters — covering parallelization, orchestrator-workers, evaluator-optimizer, and fully autonomous agents — are coming as this tutorial continues through the rest of [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents).

---

**Next:** [Chapter 4 — Workflow: Parallelization →](./chapter-04-parallelization.md)

---

> Back to [docs index](./README.md) · [project root](../README.md)
