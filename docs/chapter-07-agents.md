# Chapter 7 — Agents

## What is an Agent?

Every prior chapter in this tutorial is a **workflow**: the *code* decides the sequence of steps — outline → gate → document; classify → respond; plan → parallel workers → synthesize; search → evaluate → repeat. An **agent** is different — there's no predefined path at all:

> "Agents, on the other hand, are systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks."
>
> "Agents begin their work with either a command from, or interactive discussion with, the human user. Once the task is clear, agents plan and operate independently... During execution, it's crucial for the agents to gain 'ground truth' from the environment at each step (such as tool call results or code execution) to assess its progress."

This chapter implements a miniature version of Anthropic's own primary example:

> "A coding Agent to resolve SWE-bench tasks, which involve edits to many files based on a task description."

---

## Workflow vs. Agent, Concretely

| | Every prior chapter (workflow) | This chapter (agent) |
|---|---|---|
| **Who decides the steps?** | The route's code (a fixed sequence, or a bounded loop with fixed exit conditions) | The model itself, turn by turn |
| **How many steps run?** | A specific number, or a loop bounded by an explicit, code-checked condition (e.g. Chapter 6's `sufficient` flag) | Whatever the model decides — the code only sets a safety cap |
| **What stops it?** | The workflow finishing its defined steps | The model deciding it's done, or hitting the safety cap |

The only thing fixed in advance here is `stopWhen: stepCountIs(MAX_STEPS)` (`app/api/agent/route.ts`) — a safety net, not a plan. Everything else — whether to write code, run it, read the result, retry, or stop — is the model's own call.

---

## The Task (This Chapter)

A self-correcting coding agent: given a coding task (optionally with starter code) and a set of test cases, it uses the `execute_javascript` tool (the same sandbox from Chapter 1) to:

1. Write or test a solution.
2. Read the **actual** pass/fail output from running it — real "ground truth from the environment," not its own assumption about whether the code works.
3. Decide for itself whether to fix a bug and try again, or stop.

This is the same tool from Chapter 1's augmented LLM, but used completely differently: there, the model might call it once for a quick calculation. Here, the model can call it repeatedly, in a loop it controls, using each result to decide its next move.

---

## When to Use Agents (vs. a Workflow)

- The task is open-ended enough that you can't predict how many steps it'll take, or even hardcode the right sequence of steps at all.
- You have a reliable way for the model to get real feedback from the environment at each step (here: actual test execution results) — without that, an agent has nothing but its own guesses to correct itself with.
- You're willing to trade the predictability of a workflow for the flexibility of letting the model manage its own process — Anthropic's own caution applies: "the autonomous nature of agents means higher costs, and the potential for compounding errors," so this pattern is best reserved for tasks that genuinely need it.

---

## Architecture (This Chapter)

```
User's coding task (+ optional starter code, + test cases)
    ↓
POST /api/agent  { prompt, sessionId }
    ↓
streamText({ tools: { execute_javascript }, stopWhen: stepCountIs(10) })
    │
    │  the model decides, every turn:
    ├── call execute_javascript  → read the real pass/fail output
    ├── call execute_javascript again (fix + retest)  → read the real output
    ├── ... (as many times as the model itself decides)
    └── reply with final text   → stop
    ↓
Every tool call, its real output, and the model's own commentary streamed live, in order
    ↓
Full transcript saved to SQLite for this session
```

Unlike every prior chapter, there's no code-defined "Step 1 / Step 2 / Step 3" here — the route just relays whatever the model actually does, live, as it happens.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/agent/route.ts` | The single `streamText` call with `execute_javascript` and a safety cap — no orchestration logic beyond that |
| `app/components/Agent.tsx` | Single-shot workflow UI (same `hasRun` input-lock pattern as Chapters 2, 5, and 6), with example tasks designed to *guarantee* at least one real fix-it cycle |
| `lib/js-sandbox.ts` | The same sandboxed `execute_javascript` tool from Chapter 1 — the agent's only source of "ground truth" |

---

## The Route, Step by Step

```ts
// app/api/agent/route.ts
const result = streamText({
  model: openai(DEFAULT_MODEL),
  system: AGENT_SYSTEM_PROMPT,
  prompt: `Coding task:\n${prompt}`,
  stopWhen: stepCountIs(MAX_STEPS), // the only thing bounded in advance
  tools: {
    execute_javascript: tool({
      description: JS_SANDBOX_TOOL_DESCRIPTION,
      inputSchema: jsSandboxInputSchema,
      execute: async ({ code }) => runJavaScript(code),
    }),
  },
});

for await (const part of result.fullStream) {
  if (part.type === "tool-call" && part.toolName === "execute_javascript") {
    // stream "Attempt N — Writing & Running Code" + the code
  } else if (part.type === "tool-result" && part.toolName === "execute_javascript") {
    // stream the real output or error
  } else if (part.type === "text-delta") {
    // stream the model's own commentary / final answer
  }
}
```

**Key points:**
- There's exactly one `streamText` call here — no second or third LLM call, no orchestration code deciding what happens after a tool result comes back. The model sees its own tool result and decides the next move within the *same* call, across as many steps as it needs (up to `MAX_STEPS`).
- The route iterates `result.fullStream` — every part of the model's own turn-by-turn process (each tool call, each tool result, each bit of its own reasoning text) — rather than only awaiting a final `text`. This is what makes the agent's decision-making visible: unlike a workflow, there's no plan the code can announce in advance, so the only way to show "what it's doing" is to relay what it actually does, live.
- The system prompt explicitly instructs the model to test its own claims ("Do not just claim tests pass without actually running them and reading the real output") — because nothing in the code *forces* it to call the tool before answering. An agent's reliability depends heavily on this kind of prompt engineering around its tools, not just the tools' existence (Anthropic's Appendix 2: "prompt engineering your tools").

---

## What Happens When You Give It a Task

For one of the built-in examples — fix a given `isPrime` function that incorrectly treats `1` as prime:

1. **Browser** → `POST /api/agent` `{ prompt, sessionId }` with the buggy starter code and 7 test cases
2. **Attempt 1**: the model runs the code as given against all 7 tests — the real output shows `Test 1: isPrime(1) expected false, got true — FAIL`, with the other 6 passing
3. The model reads that real failure, correctly diagnoses the `n <= 1 return true` bug (not from re-reading the code, but from the actual test output), and rewrites the function
4. **Attempt 2**: it reruns the corrected version against all 7 tests — every one now genuinely passes
5. The model replies with the fixed code and a one-line summary ("Attempt summary: 2 attempts")
6. The full transcript (both attempts' code, real output, and the final reply) is saved to SQLite as the assistant's reply, so it shows up in **Previous Chats** and can be resumed

Give it a harder, open-ended task instead of one of the guaranteed-bug examples, and the number of attempts becomes genuinely unpredictable — anywhere from 1 up to the `MAX_STEPS` safety cap, entirely the model's own call.

---

> This is the final chapter of the tutorial, covering every pattern from Anthropic's [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents): the augmented LLM building block, five workflows, and agents.

---

> Back to [docs index](./README.md) · [project root](../README.md)
