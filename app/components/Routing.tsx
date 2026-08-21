"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCompletion } from "@ai-sdk/react";
import ChatHeader from "@/app/components/chat/ChatHeader";
import ChatInput from "@/app/components/chat/ChatInput";
import { StreamingMessage, ErrorMessage } from "@/app/components/chat/StreamingMessage";
import { useSession } from "@/app/components/chat/useSession";
import type { ChatMessage } from "@/app/components/chat/types";

// ─── Workflow: Routing ────────────────────────────────────────────────────────
// "Directing different types of customer service queries (general questions,
// refund requests, technical support) into different downstream processes,
// prompts, and tools." Each message is classified first, then answered with a
// category-specific system prompt and tool set — the server route
// (app/api/routing/route.ts) shows which category it picked before streaming
// the specialized reply, so the routing decision stays visible.

const SUGGESTIONS = [
  "How do I change the email address on my account?",
  "I was charged $29 on the 10th of a 30-day cycle and want to cancel — how much can I get back?",
  "The app keeps crashing whenever I try to export a report.",
];

interface RoutingProps {
  /** Session ID to restore (e.g. from the Previous Chats tab), if any */
  restoreSessionId?: string | null;
  /** Called once the restore has been applied, so the parent can clear it */
  onRestoreConsumed?: () => void;
}

export default function Routing({
  restoreSessionId,
  onRestoreConsumed,
}: RoutingProps) {
  const { sessionId, history, resetSession } = useSession({
    tab: "routing",
    restoreSessionId,
    onRestoreConsumed,
  });
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChatHistory(history);
  }, [history]);

  const { completion, complete, isLoading, error } = useCompletion({
    api: "/api/routing",
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
        avatarContent="🚦"
        avatarColor="bg-emerald-600"
        title="Workflow: Routing"
        subtitle="Classifies each message, then answers with a category-specific prompt and tools"
        isLoading={isLoading}
        onReset={handleReset}
      />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {chatHistory.length === 0 && !isLoading && (
            <div className="text-center py-16">
              <div className="text-4xl mb-4">🚦</div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-zinc-300 mb-2">
                Customer service routing
              </h3>
              <p className="text-sm text-gray-500 dark:text-zinc-500 max-w-md mx-auto mb-4">
                Send a customer support message. It&apos;s first classified as
                a general question, a refund request, or a technical issue,
                then answered with a system prompt and tools built for that
                category: general and technical queries can use web search,
                while refund requests use a JS-computed pro-rated amount.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="text-xs px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
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
                <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 flex-shrink-0">
                  🚦
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-emerald-600 text-white rounded-br-sm"
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
              avatarContent="🚦"
              avatarColor="bg-emerald-600"
              cursorColor="bg-emerald-500"
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
        placeholder="Describe your issue… (Enter to send, Shift+Enter for newline)"
        focusRingColor="focus:ring-emerald-500"
        sendButtonColor="bg-emerald-600"
        sendButtonHoverColor="hover:bg-emerald-700"
        footerNote="Routing: classify (general / refund / technical) → specialized prompt + tools"
      />
    </div>
  );
}
