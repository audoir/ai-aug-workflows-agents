"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCompletion } from "@ai-sdk/react";
import ChatHeader from "@/app/components/chat/ChatHeader";
import ChatInput from "@/app/components/chat/ChatInput";
import { StreamingMessage, ErrorMessage } from "@/app/components/chat/StreamingMessage";
import { useSession } from "@/app/components/chat/useSession";
import type { ChatMessage } from "@/app/components/chat/types";

// ─── Building block: The augmented LLM ────────────────────────────────────────
// A single LLM call augmented with retrieval (OpenAI web search), a local
// JavaScript code sandbox (Node.js `vm`) for computations, and memory —
// conversation history is persisted server-side per session in an in-memory
// SQLite database, so a chat can be resumed later from the Previous Chats tab.

const SUGGESTIONS = [
  "What are today's top world news headlines?",
  "What is the sum of all prime numbers below 100?",
  "Compute the 30th Fibonacci number.",
];

interface AugmentedLLMProps {
  /** Session ID to restore (e.g. from the Previous Chats tab), if any */
  restoreSessionId?: string | null;
  /** Called once the restore has been applied, so the parent can clear it */
  onRestoreConsumed?: () => void;
}

export default function AugmentedLLM({
  restoreSessionId,
  onRestoreConsumed,
}: AugmentedLLMProps) {
  const { sessionId, history, resetSession } = useSession({
    tab: "augmented-llm",
    restoreSessionId,
    onRestoreConsumed,
  });
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Whenever the session's restored/initial history changes (new session
  // created or a previous one restored), sync it into local chat state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChatHistory(history);
  }, [history]);

  const { completion, complete, isLoading, error } = useCompletion({
    api: "/api/augmented-llm",
    body: { sessionId },
    onFinish: (_prompt, completion) => {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: completion },
      ]);
    },
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, completion, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userMessage = input.trim();
    if (!userMessage || isLoading || !sessionId) return;

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
        avatarContent="AI"
        avatarColor="bg-blue-600"
        title="The augmented LLM"
        subtitle="Augmented with web search retrieval, a JS code sandbox, and memory"
        isLoading={isLoading}
        onReset={handleReset}
      />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-900 px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {chatHistory.length === 0 && !isLoading && (
            <div className="text-center py-16">
              <div className="text-4xl mb-4">🧱</div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-zinc-300 mb-2">
                The basic building block
              </h3>
              <p className="text-sm text-gray-500 dark:text-zinc-500 max-w-md mx-auto mb-4">
                This LLM is augmented with two capabilities: OpenAI&apos;s web
                search tool for current information, and a sandboxed
                JavaScript code executor for math, data processing, and
                computations. The model decides on its own when to use each
                one — ask it about recent events, or give it a calculation.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="text-xs px-3 py-1.5 rounded-full border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
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
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 flex-shrink-0">
                  AI
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
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
              avatarContent="AI"
              avatarColor="bg-blue-600"
              cursorColor="bg-blue-500"
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
        placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
        focusRingColor="focus:ring-blue-500"
        sendButtonColor="bg-blue-600"
        sendButtonHoverColor="hover:bg-blue-700"
        footerNote="Augmented with OpenAI web search retrieval, a JS code sandbox, and memory"
      />
    </div>
  );
}
