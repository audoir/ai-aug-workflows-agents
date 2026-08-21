# Chapter 5 — Workflow: Orchestrator-Workers

## What is Orchestrator-Workers?

**Orchestrator-workers** uses a central LLM call to dynamically break a task down into subtasks, delegates each subtask to its own worker LLM call, and synthesizes their results into one output. The key difference from Chapter 4's parallelization is *flexibility*:

> "In the orchestrator-workers workflow, a central LLM dynamically breaks down tasks, delegates them to worker LLMs, and synthesizes their results."
>
> "Whereas it's topographically similar [to parallelization], the key difference from parallelization is its flexibility—subtasks aren't pre-defined, but determined by the orchestrator based on the specific input."

This chapter implements Anthropic's own example:

> "Search tasks that involve gathering and analyzing information from multiple sources for possible relevant information."

---

## The Three Steps (This Chapter)

| Step | Implementation | Purpose |
|------|-----------------|---------|
| 1. 🧭 **Orchestrator** | `generateText` call with `output: Output.object({ schema: planSchema })` (`app/api/orchestrator-workers/route.ts`) | Plans 2-4 independent research subtasks for the question — *how many* and *what each investigates* is decided per-question, not fixed |
| 2. 🔎 **Workers** | One `generateText` call per planned subtask, all run via `Promise.all` | Each worker researches only its own assigned sub-question, using `web_search` |
| 3. 📋 **Synthesizer** | `streamText` call, streamed token-by-token to the browser | Combines every worker's findings into one coherent report answering the original question |

Compare this to Chapter 4's parallelization: there, the three guardrail voters are a fixed list defined in code (`VOTERS`), always exactly three, always the same three concerns. Here, the *plan itself* — the list of subtasks workers will run — is the orchestrator's own output, and its length and content change with every question.

---

## When to Use This Pattern

- The task's subtasks genuinely can't be predicted in advance — a question about, say, cloud GPU pricing might warrant three research angles, while a narrower question might only need one or two, and a broader one might need all four.
- You need worker calls that are independent of each other (so they can run in parallel once planned) but whose *number and shape* depend on the specific input, rather than a topology you can hardcode.
- Anthropic's own examples: coding products that make complex changes across an unpredictable number of files, and — what this chapter builds — search tasks gathering information from multiple sources.

---

## Architecture (This Chapter)

```
User research question
    ↓
POST /api/orchestrator-workers  { prompt, sessionId }
    ↓
Step 1: generateText({ output: Output.object(planSchema) })
         — orchestrator plans 2-4 subtasks: [{ title, query }, ...]
    ↓
Step 2: subtasks.map(subtask => generateText({ tools: { web_search } }))
         — one worker call per planned subtask, all via Promise.all
    ↓
Step 3: streamText()
         — synthesizes every worker's findings into one report, streamed to the browser
    ↓
Plan + worker findings + synthesized report saved to SQLite for this session
```

The plan, every worker's findings, and the synthesized report are all streamed into the same message in order — so you see *how many* subtasks the orchestrator chose and *what* each one found, not just the final report (Anthropic's "transparency" principle: show the planning steps, don't hide them).

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/orchestrator-workers/route.ts` | All three steps: plan, parallel worker research, synthesis |
| `app/components/OrchestratorWorkers.tsx` | Single-shot workflow UI — same `hasRun` input-lock pattern as Chapter 2's prompt chaining, since this is a one-shot research run rather than an ongoing chat |

---

## The Route, Step by Step

```ts
// app/api/orchestrator-workers/route.ts
const planSchema = z.object({
  subtasks: z
    .array(z.object({ title: z.string(), query: z.string() }))
    .min(2)
    .max(4),
});

const planResult = await generateText({
  model: openai(DEFAULT_MODEL),
  system: ORCHESTRATOR_SYSTEM_PROMPT,
  prompt: `Research question: ${prompt}`,
  output: Output.object({ schema: planSchema }),
});
const subtasks = planResult.output.subtasks; // dynamic length, 2-4

const workerResults = await Promise.all(
  subtasks.map(async (subtask) => {
    const result = await generateText({
      model: openai(DEFAULT_MODEL),
      system: WORKER_SYSTEM_PROMPT,
      prompt: `Sub-question: ${subtask.query}`,
      tools: { web_search: openai.tools.webSearch({}) },
    });
    return { title: subtask.title, query: subtask.query, findings: result.text.trim() };
  }),
);

const synthesisResult = streamText({
  model: openai(DEFAULT_MODEL),
  system: SYNTHESIZER_SYSTEM_PROMPT,
  prompt: `Original research question: ${prompt}\n\nFindings:\n${
    workerResults.map((w) => `### ${w.title}\n${w.findings}`).join("\n\n")
  }`,
});

for await (const delta of synthesisResult.textStream) {
  // streamed to the browser via createUIMessageStream's writer
}
```

**Key points:**
- `Output.object({ schema: planSchema })` is the Vercel AI SDK's structured-output helper for a full typed object rather than a single value — the same primitive Chapter 3's classifier and Chapter 4's voters use via `Output.choice`, here returning an array whose *length* the model itself decides (bounded by zod's `.min(2).max(4)`).
- The worker calls are dispatched with `subtasks.map(async ...)` (not a `for` loop with `await` inside), so all of them start before any are awaited — the same parallel-dispatch shape as Chapter 4's `votePromises`, just over a dynamically-sized list instead of a fixed one.
- Each worker only ever sees its own `subtask.query` — it has no visibility into the original question's full context or the other workers' findings, keeping each subtask genuinely independent and focused.
- Every step opts into `experimental_telemetry` with its own `functionId` (`orchestrator-plan`, `orchestrator-worker-{title}`, `orchestrator-synthesis`), and the plan itself is recorded as span attributes (`orchestrator.subtask_count`, `orchestrator.subtasks`), so the number and content of subtasks a given question produced is inspectable in Jaeger.
- Just like Chapters 2–4, the route uses `createUIMessageStream` + a small `emit()` helper to stream the plan, then every worker's findings, then the synthesized report into a single assistant message.

---

## What Happens When You Ask a Question

For the research question *"What are the tradeoffs between microservices and a monolith for a small startup?"*:

1. **Browser** → `POST /api/orchestrator-workers` `{ prompt, sessionId }`
2. **Step 1**: the orchestrator plans, say, 3 subtasks — e.g. "Startup team velocity," "Operational complexity," "Cost and infrastructure overhead" — each with its own focused sub-question
3. The plan streams first, listing all subtasks before any research happens
4. **Step 2**: all 3 worker calls run at once, each researching only its assigned sub-question with `web_search`; findings stream in as `**Title**\nfindings...` blocks once all workers finish
5. **Step 3**: the synthesizer reads the original question plus all 3 workers' findings and streams one coherent report reconciling them
6. The complete text (plan + findings + report) is saved to SQLite as the assistant's reply, so it shows up in **Previous Chats** and can be resumed

Ask a narrower question instead, and the orchestrator might plan only 2 subtasks; a broader one might get all 4 — the same route runs either way, with Step 2's parallel fan-out sized to whatever Step 1 decided.

---

> **Next Steps:**
> More chapters — covering evaluator-optimizer and fully autonomous agents — are coming as this tutorial continues through the rest of [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents).

---

**Next:** [Chapter 6 — Workflow: Evaluator-Optimizer →](./chapter-06-evaluator-optimizer.md)

---

> Back to [docs index](./README.md) · [project root](../README.md)
