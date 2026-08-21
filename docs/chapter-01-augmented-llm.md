# Chapter 1 — Building Block: The Augmented LLM

## What is the Augmented LLM?

The **augmented LLM** is the foundational building block behind every agentic system described in Anthropic's [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents). It's a single LLM call enhanced with augmentations — most commonly **retrieval**, **tools**, and **memory** — that the model can use on its own initiative.

> "The basic building block of agentic systems is an LLM enhanced with augmentations such as retrieval, tools, and memory. Our current models can actively use these capabilities — generating their own search queries, selecting appropriate tools, and determining what information to retain."

Crucially, there's no custom orchestration code deciding *when* to search the web or *when* to run some code — the model itself decides, on every turn, whether an augmentation is needed. This chapter implements exactly that: one `streamText` call, three augmentations, zero hardcoded branching logic.

---

## The Three Augmentations (This Chapter)

| Augmentation | Implementation | What it gives the model |
|--------------|-----------------|--------------------------|
| 🔎 **Retrieval** | OpenAI's built-in `web_search` tool (`openai.tools.webSearch({})`) | Up-to-date information beyond the model's training cutoff, with citations |
| 🧮 **Tools** | A sandboxed `execute_javascript` tool backed by Node's `vm` module | Reliable math, data processing, and logic that's easier to compute in code than reason about in text |
| 🧠 **Memory** | Conversation history persisted per-session in an in-memory SQLite database | Multi-turn context, and the ability to resume a past conversation later |

The model is given both tools on every call and told, via the system prompt, roughly when each one is useful — but nothing in the code forces it to use either one. Ask it "What's 2+2?" and it'll likely just answer directly; ask it a calculation-heavy question and it reaches for `execute_javascript`; ask about current events and it reaches for `web_search`.

---

## When to Use This Pattern

This is the simplest possible agentic system, and Anthropic's advice is to start here and only add complexity (workflows, multi-step agents) when a single augmented call demonstrably falls short:

- Single-turn or short multi-turn tasks where one model call, given the right tools, can complete the whole job.
- Tasks that need current information, precise computation, or persistent context, but don't need multiple specialized steps or dynamic planning.
- As the base unit that every workflow and agent pattern in later chapters is built out of — a routing workflow, for example, is just several augmented LLM calls behind a classifier.

---

## Architecture (This Chapter)

```
User prompt
    ↓
POST /api/augmented-llm  { prompt, sessionId }
    ↓
lib/chat-session.ts → loads prior messages for sessionId from SQLite (memory)
    ↓
🤖 streamText()  (single LLM call, tools attached)
    │
    ├── model decides: needs current info?  → calls web_search           (retrieval)
    ├── model decides: needs computation?   → calls execute_javascript   (tools)
    └── model decides: neither needed       → answers directly
    ↓
Response streamed token-by-token back to the browser
    ↓
onFinish → assistant reply saved back to SQLite for this session          (memory)
```

There's no orchestrator, no router, no second LLM call — `stopWhen: stepCountIs(5)` simply caps how many tool-call round trips a single request can take before the model must produce a final answer.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/augmented-llm/route.ts` | The augmented LLM itself — one `streamText` call with both tools attached |
| `lib/js-sandbox.ts` | The `execute_javascript` tool: a sandboxed Node.js `vm` context, its Zod input schema, and its description |
| `lib/db.ts` | In-memory SQLite database setup (`chat_sessions`, `chat_messages` tables) |
| `lib/chat-session.ts` | Loads/creates a session's history before the call, saves the assistant's reply after |
| `app/components/AugmentedLLM.tsx` | Chat UI for this tab, using the Vercel AI SDK's `useCompletion` hook |
| `app/components/chat/useSession.ts` | Creates a new session or restores a previous one from the server |
| `app/api/session/route.ts` | Creates a new session / fetches one session's full history |
| `app/api/sessions/route.ts` | Lists all saved sessions across every tab, for the **Previous Chats** tab |
| `app/components/PreviousChats.tsx` | Browse and resume any past conversation — the "memory" augmentation made visible |

---

## Running the App

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. You'll see two tabs: **🧱 Building block: The augmented LLM** (the chat interface) and **🕘 Previous Chats** (a browser for every saved session).

In the augmented LLM tab, try one of the suggestion prompts — for example:

> *"What are today's top world news headlines?"*
> *"What is the sum of all prime numbers below 100?"*

The first triggers `web_search`; the second triggers `execute_javascript`. Reload the page or open **Previous Chats** afterward — the conversation is still there, since it's persisted server-side.

---

## Walkthrough: File by File

### 1. `lib/db.ts` — The In-Memory Database (Memory)

`lib/db.ts` creates a singleton in-memory SQLite database using `better-sqlite3`, with two tables that back the "memory" augmentation:

```ts
// lib/db.ts
export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Each chat session belongs to exactly one building-block tab (e.g.
  // "augmented-llm"), so the history view can show which tab a chat came
  // from and restore it into the right place.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      tab TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    )
  `);

  return db;
}
```

**Key points:**
- `":memory:"` means the database is **not persisted to disk** — it resets whenever the Next.js server restarts.
- The function is a singleton: the first call creates the schema; subsequent calls reuse the same instance for the life of the process.
- `chat_sessions.tab` tags every session with the building-block tab it belongs to (`"augmented-llm"` here), which is what lets the **Previous Chats** tab route a restore back to the right place.

---

### 2. `lib/chat-session.ts` — Session Helpers (Memory)

Two small functions wrap all the SQL needed to give the augmented LLM multi-turn memory:

```ts
// lib/chat-session.ts
export function initChatSession(
  db: Database.Database,
  sessionId: string,
  tab: string,
  prompt?: string,
): { role: "user" | "assistant"; content: string }[] {
  // ...creates the session row if it doesn't exist yet, inserts the new
  // user prompt if one was passed, then returns the full history so far...
}

export function saveAssistantMessage(
  db: Database.Database,
  sessionId: string,
  text: string,
): void {
  // ...inserts the assistant's reply and bumps chat_sessions.updated_at...
}
```

**Key points:**
- `initChatSession` is called at the start of every request — it ensures the session exists, appends the new user message, and returns the whole conversation so far in the `{ role, content }[]` shape `streamText` expects for `messages`.
- `saveAssistantMessage` is called from `onFinish`, once the model's full reply is known, and also bumps `updated_at` so the **Previous Chats** list can sort by recency.

---

### 3. `lib/js-sandbox.ts` — The JavaScript Sandbox Tool

```ts
// lib/js-sandbox.ts
export const jsSandboxInputSchema = z.object({
  code: z
    .string()
    .describe(
      "The JavaScript code to execute. Must include console.log(...) to output the result you want to see, since the return value of the code itself is not captured.",
    ),
});

export function runJavaScript(code: string): JsSandboxResult {
  const logs: string[] = [];

  const sandbox = {
    console: {
      log: (...args: unknown[]) => logs.push(args.map(formatLogArg).join(" ")),
      error: (...args: unknown[]) => logs.push("ERROR: " + args.map(formatLogArg).join(" ")),
    },
    Math,
    Date,
    JSON,
    // Notice: `process`, `require`, `fs`, and other Node globals are
    // intentionally NOT injected here, keeping the sandbox safe.
  };

  const context = vm.createContext(sandbox);
  const script = new vm.Script(code);
  script.runInContext(context, { timeout: EXECUTION_TIMEOUT_MS }); // 1000ms
  return { success: true, logs: logs.join("\n") };
}
```

**Key points:**
- Code runs in an isolated Node.js `vm` context, exposed only `console`, `Math`, `Date`, and `JSON` — no `require`, `process`, `fs`, or network access.
- A strict 1-second timeout guards against infinite loops or otherwise pathological code the model might write.
- Since the sandbox can't capture a return value, the tool's description explicitly instructs the model to `console.log()` whatever it wants to see — a small but important piece of "prompt engineering your tools," per Anthropic's Appendix 2.
- Both success and failure paths return captured `logs`, so the model can see partial output even when a script throws partway through.

---

### 4. `app/api/augmented-llm/route.ts` — The Augmented LLM Itself

This is the whole pattern, in one API route:

```ts
// app/api/augmented-llm/route.ts
export async function POST(req: Request) {
  const { prompt, sessionId } = await req.json();

  const db = getDb();
  const messages = initChatSession(db, sessionId, TAB, prompt);

  const result = streamText({
    model: DEFAULT_MODEL,
    system:
      "You are a helpful AI assistant. Use the web_search tool when a question needs current or up-to-date information, and cite sources when you do. Use the execute_javascript tool for math, data processing, or any logic that's more reliable to compute in code than in your head — always console.log() the final answer so you can see it. Be concise and friendly in your responses.",
    messages,
    stopWhen: stepCountIs(5),
    tools: {
      web_search: openai.tools.webSearch({}),
      execute_javascript: tool({
        description: JS_SANDBOX_TOOL_DESCRIPTION,
        inputSchema: jsSandboxInputSchema,
        execute: async ({ code }) => runJavaScript(code),
      }),
    },
    onFinish: async ({ text }) => {
      saveAssistantMessage(db, sessionId, text);
    },
  });

  return result.toUIMessageStreamResponse();
}
```

**Key points:**
- `streamText` (not `generateText`) streams the response token-by-token to the browser as it's generated.
- Both `web_search` and `execute_javascript` are attached to every call — there's no routing or classification step deciding which tool is relevant; the model reads the system prompt and the user's message and picks for itself.
- `stopWhen: stepCountIs(5)` bounds the tool-call loop: the model can call a tool, see the result, and call another (or the same) tool again, up to 5 steps, before it must produce a final text answer.
- `messages` comes from `initChatSession`, giving the model the full prior conversation for this session — the memory augmentation, made concrete.
- `onFinish` is where the memory augmentation is completed: the assistant's final text is written back to SQLite so the next request (or a resumed session) sees it.

---

### 5. `app/components/AugmentedLLM.tsx` — The Chat UI

```tsx
// app/components/AugmentedLLM.tsx
const { completion, complete, isLoading, error } = useCompletion({
  api: "/api/augmented-llm",
  body: { sessionId },
  onFinish: (_prompt, completion) => {
    setChatHistory((prev) => [...prev, { role: "assistant", content: completion }]);
  },
});
```

**Key points:**
- `useCompletion` from `@ai-sdk/react` sends a `POST` to `/api/augmented-llm` with `{ prompt, sessionId }` and streams the response back.
- While `isLoading` is true, `<StreamingMessage>` renders the partial `completion` text with a blinking cursor, so you can watch the answer (and any tool calls) form in real time.
- The empty state renders a short explanation of the two augmentations plus clickable suggestion prompts, to get you started quickly.
- `sessionId` and `history` come from the shared `useSession` hook (`app/components/chat/useSession.ts`), which either creates a brand-new session via `POST /api/session` or restores one via `GET /api/session?sessionId=...` when the user clicks an entry in **Previous Chats**. Clicking **Reset chat** calls `resetSession()` to start fresh.

---

### 6. `app/components/PreviousChats.tsx` — Memory, Made Visible

The **Previous Chats** tab is powered by `GET /api/sessions`, which lists every session (across all building-block tabs) that has at least one message, ordered by most recently updated:

```ts
// app/api/sessions/route.ts
const sessions = db
  .prepare(
    `SELECT s.id, s.tab, s.created_at, s.updated_at,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
        (SELECT content FROM chat_messages m
          WHERE m.session_id = s.id AND m.role = 'user'
          ORDER BY m.created_at ASC LIMIT 1) AS preview
      FROM chat_sessions s
      WHERE (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) > 0
      ORDER BY s.updated_at DESC`,
  )
  .all();
```

Clicking any entry calls `onRestoreChat(tab, sessionId)`, which switches the main tab and passes `restoreSessionId` down to `AugmentedLLM`, which hands it to `useSession` to fetch that session's full history via `GET /api/session` and resume the conversation exactly where it left off.

---

## What Happens When You Send a Prompt

Here's the full request flow for the prompt *"What is the sum of all prime numbers below 100?"*:

1. **Browser** → `POST /api/augmented-llm` `{ prompt, sessionId }`
2. `initChatSession` ensures the session exists in SQLite, saves the user's message, and loads the full history
3. `streamText` sends the conversation (with both tools attached) to the model
4. The model decides this needs computation and calls `execute_javascript` with code that sums primes below 100 and `console.log()`s the result
5. `runJavaScript` executes the snippet in the sandboxed `vm` context and returns the captured logs
6. The model reads the tool result and composes a final natural-language answer citing the computed value
7. The answer streams token-by-token back to the browser via `toUIMessageStreamResponse()`
8. `onFinish` fires once streaming completes, saving the assistant's reply to SQLite so it's there next time this session is loaded

Swap in a question like *"What are today's top world news headlines?"* and the same flow plays out, except the model reaches for `web_search` instead of `execute_javascript` — same route, same single LLM call, different tool chosen entirely by the model.

---

> **Next Steps:**
> More chapters — covering prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer, and fully autonomous agents — are coming as this tutorial continues through the rest of [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents).

---

**Next:** [Chapter 2 — Workflow: Prompt Chaining →](./chapter-02-prompt-chaining.md)

---

> Back to [docs index](./README.md) · [project root](../README.md)
