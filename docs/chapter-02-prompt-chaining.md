# Chapter 2 — Workflow: Prompt Chaining

## What is Prompt Chaining?

**Prompt chaining** decomposes a task into a sequence of fixed steps, where each LLM call processes the output of the previous one — with a programmatic **gate** on an intermediate step to check the process is still on track before continuing. Unlike the augmented LLM from Chapter 1, there's no model deciding what to do next: the *code path* is predefined, and the model is only ever asked to do one well-scoped thing per step.

> "Prompt chaining decomposes a task into a sequence of steps, where each LLM call processes the output of the previous one. You can add programmatic checks (see "gate" in the diagram below) on any intermediate steps to ensure that the process is still on track."

This chapter implements Anthropic's own second example verbatim:

> "Writing an outline of a document, checking that the outline meets certain criteria, then writing the document based on the outline."

---

## The Three Fixed Steps (This Chapter)

| Step | Implementation | Purpose |
|------|-----------------|---------|
| 1. 📝 **Outline** | `generateText` call with OpenAI's `web_search` tool attached | Drafts a markdown outline for the user's topic, grounded in current information when useful |
| 2. 🚦 **Gate** | A plain, deterministic TypeScript check (`lib/prompt-chain.ts`) | Programmatically inspects the outline's section count, word count, and leftover placeholder text — no LLM judgment involved |
| 3. 📄 **Document** | `streamText` call, streamed token-by-token to the browser | Writes the full document, section by section, from the gate-approved outline |

If the gate fails, the outline (plus the specific issues found) is sent back to the model for **one** revision pass before step 3 runs regardless — a bounded retry, not an open-ended loop.

---

## When to Use This Pattern

- The task decomposes cleanly into an ordered sequence of fixed subtasks — you know in advance exactly what steps will run and in what order.
- You're trading a bit of latency (three model calls instead of one) for higher accuracy: each call is a simpler, more focused task than asking one call to research, structure, and write a whole document at once.
- You have a cheap, deterministic way to validate an intermediate output (like counting sections or words) rather than needing another LLM call to judge it — that's what makes the "gate" programmatic rather than another model call.

---

## Architecture (This Chapter)

```
User prompt (a topic)
    ↓
POST /api/prompt-chain  { prompt, sessionId }
    ↓
Step 1: generateText()  — outline, with web_search tool attached
    ↓
Step 2: evaluateGate(outline)  — plain TypeScript check (lib/prompt-chain.ts)
    │
    ├── passed  → continue to Step 3
    └── failed  → generateText() one revision pass (still with web_search) → re-check
                   → continue to Step 3 regardless (MAX_ATTEMPTS = 2)
    ↓
Step 3: streamText()  — full document written from the outline, streamed to the browser
    ↓
onFinish (implicit) → assistant reply (all three steps' output) saved to SQLite for this session
```

Every step's output — the outline, the gate's pass/fail summary, and the document — is written into the *same* streamed message via `createUIMessageStream`, so the whole chain is visible in the chat bubble as it happens, in order.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/prompt-chain/route.ts` | The three fixed steps in sequence: outline → gate → (optional revision) → document |
| `lib/prompt-chain.ts` | The gate itself: inspects the outline's structure and evaluates it against fixed criteria |
| `app/components/PromptChain.tsx` | Chat UI for this tab, using the same `useCompletion` pattern as Chapter 1 |
| `app/components/chat/useSession.ts`, `app/api/session/route.ts` | Session creation/restoration — identical mechanism to Chapter 1, tagged with the `"prompt-chaining"` tab |

---

## The Gate, in Detail

The gate is a plain, deterministic function — not another LLM call:

```ts
// lib/prompt-chain.ts
export const MIN_SECTIONS = 3;
export const MIN_WORDS = 40;
export const MAX_WORDS = 600;

const HEADING_PATTERN = /^(#{1,6}\s|\d+[.)]\s|[-*]\s)/;
const PLACEHOLDER_PATTERN = /\b(TBD|TODO|FIXME|XXX)\b|\[\s*(insert|placeholder|tk)\b[^\]]*\]/i;

function computeGateMetrics(outline: string): GateMetrics {
  const lines = outline.split("\n").map((l) => l.trim()).filter(Boolean);
  const sectionCount = lines.filter((l) => HEADING_PATTERN.test(l)).length;
  const wordCount = outline.trim().split(/\s+/).filter(Boolean).length;
  const hasPlaceholders = PLACEHOLDER_PATTERN.test(outline);
  return { sectionCount, wordCount, hasPlaceholders };
}

export function evaluateGate(outline: string): GateResult {
  const metrics = computeGateMetrics(outline);

  const issues: string[] = [];
  if (metrics.sectionCount < MIN_SECTIONS) issues.push(/* ... */);
  if (metrics.wordCount < MIN_WORDS) issues.push(/* ... */);
  if (metrics.wordCount > MAX_WORDS) issues.push(/* ... */);
  if (metrics.hasPlaceholders) issues.push(/* ... */);

  return { passed: issues.length === 0, metrics, issues };
}
```

**Key points:**
- This is the "programmatic check" (the gate, in Anthropic's diagram) that keeps prompt chaining cheap, fast, and deterministic to validate, in contrast to the evaluator-optimizer pattern covered in a later chapter, where the evaluator *is* another model call.
- Criteria are intentionally simple and explainable: at least 3 section headings, between 40 and 600 words, and no leftover placeholder text (`TBD`, `TODO`, `[insert ...]`, etc.) — the kind of check a human reviewer might do at a glance, just automated.

---

## The Route, Step by Step

```ts
// app/api/prompt-chain/route.ts
const outlineResult = await generateText({
  model: openai(DEFAULT_MODEL),
  system: OUTLINE_SYSTEM_PROMPT,
  prompt: `Write an outline for a short document about: ${prompt}`,
  tools: { web_search: openai.tools.webSearch({}) },
});

let outline = outlineResult.text.trim();
let gate = evaluateGate(outline);

if (!gate.passed) {
  const revision = await generateText({
    model: openai(DEFAULT_MODEL),
    system: OUTLINE_REVISION_SYSTEM_PROMPT,
    prompt: `Revise this outline to fix the following issues:\n${gate.issues.join("\n")}\n\nOriginal outline:\n${outline}`,
    tools: { web_search: openai.tools.webSearch({}) },
  });
  outline = revision.text.trim();
  gate = evaluateGate(outline);
}

const docResult = streamText({
  model: openai(DEFAULT_MODEL),
  system: DOCUMENT_SYSTEM_PROMPT,
  prompt: `Write the full document based on this outline:\n\n${outline}`,
});

for await (const delta of docResult.textStream) {
  // streamed to the browser via createUIMessageStream's writer
}
```

**Key points:**
- `web_search` is attached to *both* the outline call and the revision call — the model decides for itself, per Chapter 1's augmented-LLM pattern, whether a given topic benefits from research; the chain doesn't force a search.
- The revision pass runs at most once (`MAX_ATTEMPTS = 2` total outline attempts): the chain always proceeds to Step 3 afterward, so a stubbornly failing outline still produces a document rather than looping indefinitely — this is a workflow, not an open-ended agent.
- Because `streamText`/`generateText` calls aren't natively composable into one UI message stream, the route uses `createUIMessageStream` + a small `emit()` helper to manually push `text-delta` chunks for every step (the outline, the gate summary, and the document) into a single streamed assistant message.
- Each step also opts into `experimental_telemetry` with its own `functionId` (`prompt-chain-outline`, `prompt-chain-outline-revision`, `prompt-chain-document`) and the gate's pass/fail per attempt is recorded as span attributes, so the whole chain is inspectable in Jaeger as three distinct child calls under one request span.

---

## What Happens When You Send a Topic

For the prompt *"The basics of how solar panels work"*:

1. **Browser** → `POST /api/prompt-chain` `{ prompt, sessionId }`
2. **Step 1**: `generateText` drafts a 4-5 section markdown outline (the model may or may not call `web_search`, depending on whether it judges the topic needs current information)
3. **Step 2**: `evaluateGate` runs the check — in practice, a reasonably prompted outline call almost always passes on the first attempt (enough sections, sensible length, no placeholders)
4. If the gate had failed, **Step 2b** would send the outline plus the specific issues back to the model for one revision, then re-run the gate
5. **Step 3**: `streamText` writes the full document section-by-section, streamed token-by-token into the same message
6. The complete text (outline + gate summary + document) is saved to SQLite as the assistant's reply, so it shows up in **Previous Chats** and can be resumed

---

> **Next Steps:**
> More chapters — covering routing, parallelization, orchestrator-workers, evaluator-optimizer, and fully autonomous agents — are coming as this tutorial continues through the rest of [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents).

---

**Next:** [Chapter 3 — Workflow: Routing →](./chapter-03-routing.md)

---

> Back to [docs index](./README.md) · [project root](../README.md)
