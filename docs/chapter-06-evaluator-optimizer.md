# Chapter 6 — Workflow: Evaluator-Optimizer

## What is Evaluator-Optimizer?

**Evaluator-optimizer** runs one LLM call that generates a response, and a second LLM call that evaluates it and decides whether to loop back for another attempt — repeating until the evaluator is satisfied.

> "In the evaluator-optimizer workflow, one LLM call generates a response while another provides evaluation and feedback in a loop."
>
> "This workflow is particularly effective when we have clear evaluation criteria, and when iterative refinement provides measurable value."

This chapter implements Anthropic's own example:

> "Complex search tasks that require multiple rounds of searching and analysis to gather comprehensive information, where the evaluator decides whether further searches are warranted."

---

## The Loop (This Chapter)

| Step | Implementation | Purpose |
|------|-----------------|---------|
| 🔎 **Searcher** | `generateText` call with `web_search` (`app/api/evaluator-optimizer/route.ts`) | Researches the current query, building on prior rounds' findings without repeating them |
| 🧑‍⚖️ **Evaluator** | `generateText` call with `output: Output.object({ schema: evaluationSchema })` | Judges whether accumulated findings comprehensively answer the question, or specifies the one biggest gap to search next |

These two steps repeat in a `while` loop — up to `MAX_ROUNDS = 3` — rather than running a fixed number of times. The evaluator's own verdict (`sufficient: true/false`) decides whether the loop continues, which is the key difference from every prior chapter: Chapter 2's gate checks an outline *once* and revises *once*; Chapter 5's orchestrator plans subtasks *once* up front. Here, the number of rounds is only bounded by a safety cap, not predetermined.

---

## When to Use This Pattern

- There's a clear, checkable criterion for "is this response good enough" — here, whether the gathered findings comprehensively cover the question.
- Iterative refinement plausibly improves the result — more search rounds genuinely surface more relevant information, the same way a human researcher would dig further after noticing a gap.
- The *number* of iterations needed isn't knowable in advance — a narrow, well-covered question might be sufficient after round 1, while a broad or contested one might need all 3 rounds.

---

## Architecture (This Chapter)

```
User research question
    ↓
POST /api/evaluator-optimizer  { prompt, sessionId }
    ↓
┌─── round = 1 ──────────────────────────────────────────────┐
│ generateText({ tools: { web_search } })                    │  ← Searcher
│   — researches `query`, builds on prior rounds' findings    │
│ generateText({ output: Output.object(evaluationSchema) })   │  ← Evaluator
│   — { sufficient, reasoning, nextQuery }                    │
└──────────────────────────────────────────────────────────────┘
    │
    ├── sufficient === true          → break, proceed to answer
    ├── round >= MAX_ROUNDS (3)      → break, proceed to answer anyway
    └── otherwise                    → query = nextQuery; round += 1; loop
    ↓
streamText()  — final answer synthesized from every round's findings
    ↓
Every round's search + evaluation + the final answer saved to SQLite for this session
```

Every round's search findings and evaluator verdict are streamed in order as they happen — so you can watch the evaluator decide, round by round, whether to keep digging (Anthropic's "transparency" principle again: show the planning/evaluation steps, don't hide them).

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/evaluator-optimizer/route.ts` | The searcher ⇄ evaluator loop, plus the final synthesized answer |
| `app/components/EvaluatorOptimizer.tsx` | Single-shot workflow UI — same `hasRun` input-lock pattern as Chapters 2 and 5, since this is a one-shot research run rather than an ongoing chat |

---

## The Route, Step by Step

```ts
// app/api/evaluator-optimizer/route.ts
const rounds: Round[] = [];
let round = 1;
let query = prompt;

while (round <= MAX_ROUNDS) {
  const searchResult = await generateText({
    model: openai(DEFAULT_MODEL),
    system: SEARCHER_SYSTEM_PROMPT,
    prompt: `Original question: ${prompt}\n\nPrior findings:\n${
      rounds.map((r, i) => `Round ${i + 1} (${r.query}):\n${r.findings}`).join("\n\n")
    }\n\nCurrent search query: ${query}`,
    tools: { web_search: openai.tools.webSearch({}) },
  });
  rounds.push({ query, findings: searchResult.text.trim() });

  const evaluation = await generateText({
    model: openai(DEFAULT_MODEL),
    system: EVALUATOR_SYSTEM_PROMPT,
    prompt: `Original question: ${prompt}\n\nFindings gathered so far:\n${
      rounds.map((r, i) => `Round ${i + 1} (${r.query}):\n${r.findings}`).join("\n\n")
    }`,
    output: Output.object({ schema: evaluationSchema }),
  });

  const verdict = evaluation.output;
  if (verdict.sufficient) break;
  if (round >= MAX_ROUNDS) break;

  query = verdict.nextQuery ?? prompt;
  round += 1;
}

const answerResult = streamText({
  model: openai(DEFAULT_MODEL),
  system: ANSWER_SYSTEM_PROMPT,
  prompt: `Original question: ${prompt}\n\nFindings gathered across ${rounds.length} round(s):\n${
    rounds.map((r, i) => `Round ${i + 1} (${r.query}):\n${r.findings}`).join("\n\n")
  }`,
});

for await (const delta of answerResult.textStream) {
  // streamed to the browser via createUIMessageStream's writer
}
```

**Key points:**
- The evaluator's schema uses `Output.object({ schema: evaluationSchema })` — the same primitive Chapter 5's orchestrator plan uses — to return a typed `{ sufficient, reasoning, nextQuery }` object rather than free text to parse. `nextQuery` is nullable rather than optional, since it only applies when `sufficient` is `false`.
- Each round accumulates into `rounds`, and every subsequent searcher/evaluator call is given the *full* history of prior rounds' findings — so the searcher knows not to repeat itself, and the evaluator judges cumulative coverage, not just the latest round in isolation.
- The loop has two independent exit conditions checked every round — `verdict.sufficient` (the evaluator is satisfied) and `round >= MAX_ROUNDS` (the safety cap) — so a stubbornly-insufficient verdict can never loop forever; this is a workflow with a bounded loop, not an open-ended agent.
- Every call opts into `experimental_telemetry` with a `functionId` that includes the round number (`evaluator-optimizer-search-round-{n}`, `evaluator-optimizer-evaluate-round-{n}`), and each round's verdict is recorded as a span attribute (`evaluator.round_{n}.sufficient`), plus `evaluator.rounds_used` once the loop exits — so how many rounds a given question needed is inspectable in Jaeger.
- Just like Chapters 2, 3, 4, and 5, the route uses `createUIMessageStream` + a small `emit()` helper to stream every round's search findings and evaluation verdict, then the final synthesized answer, into one assistant message.

---

## What Happens When You Ask a Question

For the research question *"What is the state of competition in the AI coding assistant market?"*:

1. **Browser** → `POST /api/evaluator-optimizer` `{ prompt, sessionId }`
2. **Round 1 searcher**: researches the question directly, finding a plausible high-level picture from a handful of vendor pages
3. **Round 1 evaluator**: judges this insufficient — reasoning that the findings lean on a small set of vendor sources without independent market data — and returns a specific `nextQuery` targeting that gap
4. **Round 2 searcher**: investigates that exact follow-up query, surfacing independent market-share and adoption data
5. **Round 2 evaluator**: judges the combined findings from both rounds sufficient — the loop breaks
6. **Final answer**: `streamText` synthesizes both rounds' findings into one comprehensive, well-organized answer
7. The complete text (both rounds' searches/evaluations plus the final answer) is saved to SQLite as the assistant's reply, so it shows up in **Previous Chats** and can be resumed

A narrower, well-covered question might be judged sufficient after round 1 with no follow-up at all; a broader or more contested one might use all 3 rounds before the safety cap kicks in.

---

> **Next Steps:**
> The final chapter — covering fully autonomous agents — is coming as this tutorial wraps up [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents).

---

**Next:** [Chapter 7 — Agents →](./chapter-07-agents.md)

---

> Back to [docs index](./README.md) · [project root](../README.md)
