# Building Effective Agents — Documentation

Welcome to the documentation for the **Building Effective Agents** tutorial, a hands-on companion to Anthropic's [*"Building Effective Agents"*](https://www.anthropic.com/engineering/building-effective-agents).

## Chapters

| Chapter | Topic |
|---------|-------|
| [Chapter 1 — Building Block: The Augmented LLM](./chapter-01-augmented-llm.md) | An LLM enhanced with retrieval (web search), tool use (a JS sandbox), and memory (persisted chat history) |
| [Chapter 2 — Workflow: Prompt Chaining](./chapter-02-prompt-chaining.md) | Decomposing "write an outline, gate-check it, then write the document" into three fixed LLM calls with a programmatic gate in between |
| [Chapter 3 — Workflow: Routing](./chapter-03-routing.md) | Classifying customer service queries (general / refund / technical) and routing each to its own specialized prompt and tools |
| [Chapter 4 — Workflow: Parallelization](./chapter-04-parallelization.md) | Sectioning (answer + guardrail reviewers run at once) combined with voting (majority threshold across reviewers) to decide whether to answer or refuse |
| [Chapter 5 — Workflow: Orchestrator-Workers](./chapter-05-orchestrator-workers.md) | A dynamic plan (2-4 research subtasks, decided per question) is farmed out to parallel worker calls, then synthesized into one report |
| [Chapter 6 — Workflow: Evaluator-Optimizer](./chapter-06-evaluator-optimizer.md) | A searcher and an evaluator loop up to 3 rounds — the evaluator decides whether findings are comprehensive or another search round is warranted |
| [Chapter 7 — Agents](./chapter-07-agents.md) | A self-correcting coding agent — the model itself decides when to write code, test it, retry, or stop, bounded only by a safety cap |

This completes the tutorial's tour of every pattern from Anthropic's post: the augmented LLM building block, five workflows, and agents.

---

> Back to [project root](../README.md)
