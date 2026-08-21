# Building Effective Agents — A Hands-On Tutorial

A hands-on Next.js project that walks you through the agentic system design patterns from Anthropic's [**"Building Effective Agents"**](https://www.anthropic.com/engineering/building-effective-agents) — starting with the foundational **augmented LLM** building block and progressively working up through workflows (prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer) and fully autonomous agents.

Each pattern from the post gets its own tab in the app and its own chapter in the docs, so you can read the concept, see it running, and read the code side by side.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note:** You need an `OPENAI_API_KEY` environment variable set. Create a `.env.local` file:
>
>     OPENAI_API_KEY=sk-...

---

## Chapters

| Chapter | Topic |
|---------|-------|
| [Chapter 1 — Building Block: The Augmented LLM](./docs/chapter-01-augmented-llm.md) | An LLM enhanced with retrieval (web search), tool use (a JS sandbox), and memory (persisted chat history) |
| [Chapter 2 — Workflow: Prompt Chaining](./docs/chapter-02-prompt-chaining.md) | Outline → programmatic gate check → full document, as three fixed LLM calls with a code-based check in between |
| [Chapter 3 — Workflow: Routing](./docs/chapter-03-routing.md) | Classify customer service queries (general / refund / technical), then answer each with its own specialized prompt and tools |
| [Chapter 4 — Workflow: Parallelization](./docs/chapter-04-parallelization.md) | Answer generation and 3 guardrail reviewers run in parallel (sectioning); a majority vote across reviewers decides whether to reveal the answer or refuse (voting) |
| [Chapter 5 — Workflow: Orchestrator-Workers](./docs/chapter-05-orchestrator-workers.md) | An orchestrator dynamically plans 2-4 research subtasks, worker calls research each in parallel, and a synthesizer combines their findings into one report |
| [Chapter 6 — Workflow: Evaluator-Optimizer](./docs/chapter-06-evaluator-optimizer.md) | A search-and-evaluate loop (up to 3 rounds) where the evaluator decides whether findings are comprehensive enough or another round of searching is needed |
| [Chapter 7 — Agents](./docs/chapter-07-agents.md) | A self-correcting coding agent — no fixed steps, just a safety cap; the model decides itself whether to write code, test it, retry, or stop |

This is the final chapter — the tutorial now covers every pattern from the Anthropic post.

📖 Full documentation lives in the [`docs/`](./docs/README.md) folder.

---

## Which Pattern Should You Use?

Anthropic's own advice is to start with the simplest solution possible — often just a single, well-augmented LLM call — and only reach for a workflow or an agent when it demonstrably improves outcomes. Workflows trade latency and cost for predictability on well-defined tasks; agents trade predictability for flexibility on open-ended ones. Use this table as a quick decision guide; each row links back to the chapter that implements it.

| Pattern | Use it when... | Example scenarios (from Anthropic's post) |
|---------|-----------------|---------------------------------------------|
| [🧱 Augmented LLM](./docs/chapter-01-augmented-llm.md) | A single LLM call, given retrieval/tools/memory, can complete the whole task — no multi-step process is needed | Answering questions that need current info, precise computation, or conversational context, without multiple specialized steps |
| [📝 Prompt Chaining](./docs/chapter-02-prompt-chaining.md) | The task decomposes cleanly into a fixed sequence of subtasks; you're willing to trade latency for higher accuracy by making each LLM call simpler | Generating marketing copy, then translating it; writing an outline, gate-checking it, then writing the full document |
| [🚦 Routing](./docs/chapter-03-routing.md) | Inputs fall into distinct categories that are better handled by separate specialized prompts/tools, and classification itself is cheap and accurate | Directing customer service queries (general / refund / technical) to different prompts and tools; routing easy questions to a cheaper model and hard ones to a more capable one |
| [🧵 Parallelization](./docs/chapter-04-parallelization.md) | Subtasks can be split and run independently for speed (**sectioning**), or multiple independent attempts/perspectives raise confidence in the result (**voting**) | Sectioning: guardrails screening a query while another call answers it; automating evals across separate aspects. Voting: multiple prompts reviewing code for vulnerabilities, or judging content moderation with different thresholds |
| [🧭 Orchestrator-Workers](./docs/chapter-05-orchestrator-workers.md) | The subtasks needed can't be predicted or hardcoded in advance — a central call must decide, per input, how many workers to use and what each should do | Coding tasks that change an unpredictable number of files; search tasks gathering and analyzing information from multiple sources |
| [🔁 Evaluator-Optimizer](./docs/chapter-06-evaluator-optimizer.md) | There's a clear evaluation criterion, and iterative refinement provides measurable value (i.e., feedback demonstrably improves the response, and an LLM can generate that feedback) | Literary translation refined through critique of nuance; complex search tasks needing multiple rounds where an evaluator decides if further searching is warranted |
| [🤖 Agents](./docs/chapter-07-agents.md) | The task is open-ended enough that you can't predict or hardcode the number of steps, and you can trust the model's own decision-making (bounded by a safety cap) | Coding agents resolving SWE-bench-style GitHub issues across many files; "computer use" agents operating a GUI to accomplish a goal |

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `ai` | Vercel AI SDK — `streamText`, `generateText`, `Output`, `stepCountIs`, `tool` |
| `@ai-sdk/openai` | OpenAI provider, including the built-in web search tool |
| `@ai-sdk/react` | React hooks (`useCompletion`) for the streaming chat UI |
| `better-sqlite3` | Synchronous SQLite driver — powers in-memory chat memory |
| `zod` | Schema validation for tool inputs |

## About

This tutorial is a personal, hands-on companion to Anthropic's engineering post on building effective AI agents. Each chapter reproduces one of the patterns described there as a working, inspectable feature in this app, rather than a slide or a snippet — so you can chat with it, watch the tool calls happen, and then read exactly how it's wired up.
