"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCompletion } from "@ai-sdk/react";
import ChatHeader from "@/app/components/chat/ChatHeader";
import ChatInput from "@/app/components/chat/ChatInput";
import { StreamingMessage, ErrorMessage } from "@/app/components/chat/StreamingMessage";
import { useSession } from "@/app/components/chat/useSession";
import type { ChatMessage } from "@/app/components/chat/types";

// ─── Workflow: Evaluator-optimizer ────────────────────────────────────────────
// "Complex search tasks that require multiple rounds of searching and
// analysis to gather comprehensive information, where the evaluator decides
// whether further searches are warranted." A searcher LLM call and an
// evaluator LLM call alternate in a loop — the evaluator judges whether the
// findings so far are sufficient, and if not, hands back a specific
// follow-up query for another round. The server route
// (app/api/evaluator-optimizer/route.ts) loops up to 3 rounds before writing
// a final answer from everything gathered.

const SUGGESTIONS = [
  "What are the current leading approaches to carbon capture technology?",
  "What is the state of competition in the AI coding assistant market?",
  "How is the semiconductor industry addressing the chip shortage today?",
];

interface EvaluatorOptimizerProps {
  /** Session ID to restore (e.g. from the Previous Chats tab), if any */
  restoreSessionId?: string | null;
  /** Called once the restore has been applied, so the parent can clear it */
  onRestoreConsumed?: () => void;
}

export default function EvaluatorOptimizer({
  restoreSessionId,
  onRestoreConsumed,
}: EvaluatorOptimizerProps) {
  const { sessionId, history, resetSession } = useSession({
    tab: "evaluator-optimizer",
    restoreSessionId,
    onRestoreConsumed,
  });
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Like prompt chaining and orchestrator-workers, this tab runs a
  // single-shot research workflow, not an ongoing chat. Once one run has
  // produced a result, the input locks; "Reset chat" starts a fresh run.
  const hasRun = chatHistory.length > 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChatHistory(history);
  }, [history]);

  const { completion, complete, isLoading, error } = useCompletion({
    api: "/api/evaluator-optimizer",
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
        avatarContent="🧑‍⚖️"
        avatarColor="bg-indigo-600"
        title="Workflow: Evaluator-optimizer"
        subtitle="Loops search + evaluation until findings are comprehensive, up to 3 rounds"
        isLoading={isLoading}
        onReset={handleReset}
      />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {chatHistory.length === 0 && !isLoading && (
            <div className="text-center py-16">
              <div className="text-4xl mb-4">🧑‍⚖️</div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-zinc-300 mb-2">
                Search, evaluate, repeat
              </h3>
              <p className="text-sm text-gray-500 dark:text-zinc-500 max-w-md mx-auto mb-4">
                Ask a research question. Each round, one call searches the
                web for findings, then another call — the evaluator — judges
                whether those findings comprehensively answer the question.
                If not, it hands back a specific follow-up query and another
                round runs, up to 3 rounds, before a final answer is written
                from everything gathered.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="text-xs px-3 py-1.5 rounded-full border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                  >
                    {suggestion}
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
                <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 flex-shrink-0">
                  🧑‍⚖️
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm"
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
              avatarContent="🧑‍⚖️"
              avatarColor="bg-indigo-600"
              cursorColor="bg-indigo-500"
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
        placeholder="Ask a research question… (Enter to send, Shift+Enter for newline)"
        focusRingColor="focus:ring-indigo-500"
        sendButtonColor="bg-indigo-600"
        sendButtonHoverColor="hover:bg-indigo-700"
        footerNote={
          hasRun
            ? "This workflow runs once per question — click \"Reset chat\" above to start a new run"
            : "Evaluator-optimizer: search → evaluate → repeat (up to 3 rounds) → answer"
        }
      />
    </div>
  );
}
