"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCompletion } from "@ai-sdk/react";
import ChatHeader from "@/app/components/chat/ChatHeader";
import ChatInput from "@/app/components/chat/ChatInput";
import { StreamingMessage, ErrorMessage } from "@/app/components/chat/StreamingMessage";
import { useSession } from "@/app/components/chat/useSession";
import type { ChatMessage } from "@/app/components/chat/types";

// ─── Agents ────────────────────────────────────────────────────────────────────
// Every other tab in this app is a workflow — the code decides the sequence
// of steps. This tab is an agent: the model itself decides, turn by turn,
// whether to write code, run it, read the real pass/fail result, fix its own
// mistakes, and try again — until it succeeds or a safety cap
// (MAX_STEPS = 10, in app/api/agent/route.ts) is hit. There's no fixed
// number of attempts baked into the route; that's the model's call.

// Each of these hands the agent starter code with one deliberate,
// hand-verified bug that fails exactly one of the listed test cases — every
// other case already passes with the buggy code. Because the bug is baked
// into the starter code rather than hoped-for from the model's own mistake,
// the first sandbox run against the full test suite is *guaranteed* to fail
// on that one case — forcing at least one real read-the-output → diagnose →
// fix → re-verify cycle, regardless of how capable the model is. Every
// expected output was verified by hand in Node before writing these.
const SUGGESTIONS: { label: string; prompt: string }[] = [
  {
    label: "Fix my isPrime function (bug: isPrime(1))",
    prompt: `I have this isPrime function, but I'm not sure it's fully correct — please test it against several inputs and fix any bugs you find. Don't just review the code by eye; actually run it.

function isPrime(n) {
  if (n <= 1) return true;
  for (let i = 2; i < n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

Test it against: isPrime(1) should be false, isPrime(2) should be true, isPrime(3) should be true, isPrime(4) should be false, isPrime(17) should be true, isPrime(18) should be false, isPrime(25) should be false.`,
  },
  {
    label: "Fix my flattenOnce function (bug: empty nested array)",
    prompt: `I have this flattenOnce function, but I'm not sure it's fully correct — please test it against several inputs and fix any bugs you find. Don't just review the code by eye; actually run it.

function flattenOnce(arr) {
  const result = [];
  for (const item of arr) {
    if (Array.isArray(item) && item.length > 0) {
      result.push(...item);
    } else {
      result.push(item);
    }
  }
  return result;
}

Test it against: flattenOnce([1,[2,3],4]) should be [1,2,3,4], flattenOnce([1,[],2]) should be [1,2], flattenOnce([[1,2],[3,4]]) should be [1,2,3,4].`,
  },
  {
    label: "Fix my countVowels function (bug: uppercase input)",
    prompt: `I have this countVowels function, but I'm not sure it's fully correct — please test it against several inputs and fix any bugs you find. Don't just review the code by eye; actually run it.

function countVowels(str) {
  const vowels = 'aeiou';
  let count = 0;
  for (const ch of str) {
    if (vowels.includes(ch)) count++;
  }
  return count;
}

Test it against: countVowels('hello') should be 2, countVowels('HELLO') should be 2, countVowels('JavaScript') should be 3, countVowels('') should be 0.`,
  },
];

interface AgentProps {
  /** Session ID to restore (e.g. from the Previous Chats tab), if any */
  restoreSessionId?: string | null;
  /** Called once the restore has been applied, so the parent can clear it */
  onRestoreConsumed?: () => void;
}

export default function Agent({ restoreSessionId, onRestoreConsumed }: AgentProps) {
  const { sessionId, history, resetSession } = useSession({
    tab: "agent",
    restoreSessionId,
    onRestoreConsumed,
  });
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Like the other single-shot tabs (prompt chaining, orchestrator-workers,
  // evaluator-optimizer), this runs one autonomous task per session, not an
  // ongoing chat. Once the agent finishes, the input locks; "Reset chat"
  // starts a fresh task.
  const hasRun = chatHistory.length > 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChatHistory(history);
  }, [history]);

  const { completion, complete, isLoading, error } = useCompletion({
    api: "/api/agent",
    body: { sessionId },
    onFinish: (_prompt, completion) => {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: completion },
      ]);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, completion, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userMessage = input.trim();
    if (!userMessage || isLoading || !sessionId || hasRun) return;

    setInput("");
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage }]);
    await complete(userMessage);
  };

  const handleReset = useCallback(() => {
    setChatHistory([]);
    setInput("");
    resetSession();
  }, [resetSession]);

  if (!sessionId) {
    return (
      <div className="flex flex-col h-[calc(100vh-146px)] items-center justify-center">
        <div className="text-gray-500 dark:text-zinc-400 text-sm">
          Loading session…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-146px)]">
      <ChatHeader
        avatarContent="🤖"
        avatarColor="bg-rose-600"
        title="Agents"
        subtitle="An autonomous coding agent: writes code, runs it, reads real results, and decides itself when to retry or stop"
        isLoading={isLoading}
        onReset={handleReset}
      />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {chatHistory.length === 0 && !isLoading && (
            <div className="text-center py-16">
              <div className="text-4xl mb-4">🤖</div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-zinc-300 mb-2">
                No fixed plan — the model decides
              </h3>
              <p className="text-sm text-gray-500 dark:text-zinc-500 max-w-md mx-auto mb-4">
                Give it a coding task with test cases. It writes or tests
                code in the JS sandbox and reads the actual pass/fail
                output — real &quot;ground truth,&quot; not its own
                assumptions. If tests fail, it decides for itself whether to
                fix the bug and try again, up to a safety cap of 10 steps.
                Unlike every other tab, there&apos;s no fixed number of steps
                coded in advance. The examples below hand it starter code
                with a real bug, so you&apos;re guaranteed to see it fail
                once, diagnose why, and fix it.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    onClick={() => setInput(suggestion.prompt)}
                    className="text-xs px-3 py-1.5 rounded-full border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatHistory.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-rose-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 flex-shrink-0">
                  🤖
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-rose-600 text-white rounded-br-sm"
                    : "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white border border-gray-200 dark:border-zinc-700 rounded-bl-sm"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-full bg-gray-300 dark:bg-zinc-600 flex items-center justify-center text-gray-700 dark:text-zinc-300 text-xs font-bold ml-2 mt-1 flex-shrink-0">
                  U
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <StreamingMessage
              completion={completion}
              avatarContent="🤖"
              avatarColor="bg-rose-600"
              cursorColor="bg-rose-500"
            />
          )}

          {error && <ErrorMessage message={error.message} />}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        disabled={hasRun}
        placeholder="Describe a coding task with test cases… (Enter to send, Shift+Enter for newline)"
        focusRingColor="focus:ring-rose-500"
        sendButtonColor="bg-rose-600"
        sendButtonHoverColor="hover:bg-rose-700"
        footerNote={
          hasRun
            ? "This agent runs once per task — click \"Reset chat\" above to start a new run"
            : "Agent: writes code → runs it → reads real results → retries or stops, up to 10 steps"
        }
      />
    </div>
  );
}
