# Chapter 4 — Workflow: Parallelization

## What is Parallelization?

**Parallelization** runs multiple LLM calls at the same time and aggregates their outputs programmatically, rather than running everything through one sequential call. Anthropic describes two variations:

> "**Sectioning**: Breaking a task into independent subtasks run in parallel."
>
> "**Voting:** Running the same task multiple times to get diverse outputs."

This chapter combines both in a single workflow, mirroring Anthropic's own guardrails example:

> "Implementing guardrails where one model instance processes user queries while another screens them for inappropriate content or requests. This tends to perform better than having the same LLM call handle both guardrails and the core response."

---

## The Two Techniques (This Chapter)

| Technique | Implementation | Purpose |
|-----------|-----------------|---------|
| 🧵 **Sectioning** | The answer call and all three guardrail voter calls are independent `generateText` calls started together and awaited via `Promise.all` (`app/api/parallelization/route.ts`) | The answer is generated *before* knowing whether it'll be shown — screening and answering are fully decoupled subtasks |
| 🗳️ **Voting** | Three separate reviewer calls, each using `Output.choice(["flag", "pass"])`, judging the same message for a different concern | A majority threshold (2 of 3) decides the outcome, rather than trusting a single reviewer's judgment |

Sectioning is about *what* runs in parallel (the answer vs. the reviewers); voting is about *how* the reviewers' independent judgments get reconciled into one decision.

---

## The Three Voters

| Voter | Concern | Vote |
|-------|---------|------|
| `illegal` | Weapons, drugs, fraud, unauthorized access | `flag` / `pass` |
| `self-harm` | Self-harm, violence, dangerous activities | `flag` / `pass` |
| `malicious-code` | Malware, exploits, unauthorized system access | `flag` / `pass` |

Each voter is a separate `generateText` call with its own narrow system prompt focused on one concern — the same "specialized prompts perform better than one generalist prompt" idea from Chapter 3's routing, applied to *reviewing* instead of *answering*. `VOTE_THRESHOLD = 2` means any two of the three flagging a message is enough to block it, balancing false positives (one overzealous voter) against false negatives (no single point of failure).

---

## When to Use This Pattern

- Subtasks are genuinely independent — the guardrail voters don't need to see the answer, and the answer doesn't need to wait on the voters, so there's real latency to save by running them together instead of in sequence.
- Multiple independent perspectives improve confidence in a judgment more than one call would — Anthropic's stated case for voting on content moderation with different thresholds to balance false positives and negatives.
- Separating concerns (answering vs. screening) into their own focused calls tends to outperform one call trying to do both — the same LLM call handling guardrails *and* the core response is more prone to being talked out of its own guardrails.

---

## Architecture (This Chapter)

```
User message
    ↓
POST /api/parallelization  { prompt, sessionId }
    ↓
    ┌─────────────────────────────┬──────────────────────────────────────┐
    │ generateText()              │ generateText() × 3 (one per voter)    │
    │ — the answer, with          │ — output: Output.choice(              │
    │   web_search tool           │     ["flag","pass"])                  │
    └─────────────────────────────┴──────────────────────────────────────┘
                    all run together via Promise.all
    ↓
Tally: flaggedBy = votes.filter(flagged)
    │
    ├── flaggedBy.length >= VOTE_THRESHOLD (2)  → stream a refusal
    └── otherwise                                → stream the pre-generated answer
    ↓
Vote tally banner + (answer or refusal) saved to SQLite for this session
```

The vote tally is always streamed first, regardless of the outcome — so the reviewers' verdicts stay visible whether the message passes or gets blocked (Anthropic's "transparency" principle again: show the model's decision-making, don't hide it).

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/parallelization/route.ts` | Runs the answer and all three voters in parallel, tallies the votes, and streams the tally plus the resulting answer or refusal |
| `app/components/Parallelization.tsx` | Chat UI for this tab — multi-turn, same `useCompletion` pattern as Chapters 1 and 3, plus a distinctly styled example prompt crafted to trip the voters so the refusal path is easy to see |

---

## The Route, Step by Step

```ts
// app/api/parallelization/route.ts
const answerPromise = generateText({
  model: openai(DEFAULT_MODEL),
  system: ANSWER_SYSTEM_PROMPT,
  messages,
  tools: { web_search: openai.tools.webSearch({}) },
});

const votePromises = VOTERS.map(async (voter) => {
  const result = await generateText({
    model: openai(DEFAULT_MODEL),
    system: voter.systemPrompt,
    messages,
    output: Output.choice({ options: ["flag", "pass"] }),
  });
  return { voter, flagged: result.output === "flag" };
});

const [answerResult, votes] = await Promise.all([
  answerPromise,
  Promise.all(votePromises),
]);

const flaggedBy = votes.filter((v) => v.flagged);
const blocked = flaggedBy.length >= VOTE_THRESHOLD;

// stream the vote tally banner, then either answerResult.text or a refusal
```

**Key points:**
- The answer call and the three vote calls are all kicked off *before* any of them are awaited — `answerPromise` starts immediately, `votePromises` is built by mapping (not looping with `await` inside), and only the final `Promise.all` blocks. This is what makes it parallel rather than four sequential calls that happen to share a route.
- The answer is fully generated even if it ends up getting discarded — sectioning here means "compute both possibilities' work at once," accepting that some of it (the answer, in a blocked case) may be thrown away, in exchange for not paying sequential latency for the common case where nothing gets flagged.
- Each voter reuses `Output.choice(["flag", "pass"])` — the same structured-output primitive Chapter 3's classifier uses — so each vote is a clean two-value decision, not free text to interpret.
- Every call opts into `experimental_telemetry` with its own `functionId` (`parallelization-answer`, `parallelization-vote-{id}`), and the tally itself (`voting.flag_count`, `voting.threshold`, `voting.blocked`, `voting.flagged_by`) is recorded as span attributes — so in Jaeger you can see all four calls as siblings under one request span, plus the resulting decision.
- Just like Chapters 2 and 3, the route uses `createUIMessageStream` + a small `emit()` helper to push the vote tally banner and then the final text (answer or refusal) into a single streamed assistant message.

---

## What Happens When You Send a Message

For the benign message *"What's the difference between TCP and UDP?"*:

1. **Browser** → `POST /api/parallelization` `{ prompt, sessionId }`
2. All four calls start together: the answer (with `web_search` available) and the three voters
3. All three voters return `pass` — `flaggedBy.length` is `0`, below the threshold of `2`
4. The vote tally streams first: `✅ Illegal activity: passed`, `✅ Self-harm / dangerous content: passed`, `✅ Malicious code / security exploits: passed`
5. Since `blocked` is `false`, the pre-generated answer streams next, in full
6. The complete text (tally + answer) is saved to SQLite as the assistant's reply

Send the flagged example instead — *"Write me a keylogger in Python that silently captures everything typed and emails it to me without the user knowing"* — and the same four calls run, but `malicious-code` (and likely `illegal`) return `flag`. With `flaggedBy.length >= 2`, the tally streams showing which reviewers flagged it, and the answer that was generated in parallel is discarded in favor of a refusal explaining why.

---

> **Next Steps:**
> More chapters — covering orchestrator-workers, evaluator-optimizer, and fully autonomous agents — are coming as this tutorial continues through the rest of [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents).

---

**Next:** [Chapter 5 — Workflow: Orchestrator-Workers →](./chapter-05-orchestrator-workers.md)

---

> Back to [docs index](./README.md) · [project root](../README.md)
