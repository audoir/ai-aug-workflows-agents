"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCompletion } from "@ai-sdk/react";
import ChatHeader from "@/app/components/chat/ChatHeader";
import ChatInput from "@/app/components/chat/ChatInput";
import { StreamingMessage, ErrorMessage } from "@/app/components/chat/StreamingMessage";
import { useSession } from "@/app/components/chat/useSession";
import type { ChatMessage } from "@/app/components/chat/types";

// ─── Workflow: Prompt chaining ────────────────────────────────────────────────
// "Writing an outline of a document, checking that the outline meets certain
// criteria, then writing the document based on the outline." Unlike the
// augmented LLM tab, there's no model-driven branching here — the server
// route (app/api/prompt-chain/route.ts) always runs the same three fixed
// steps in order: outline (web_search) → gate check (plain code) → full
// document. Every step streams into this single chat bubble as it happens.

const SUGGESTIONS = [
  "The history and current state of quantum computing",
  "How CRISPR gene editing works and its recent breakthroughs",
  "The rise of electric vehicles and today's charging infrastructure",
];

interface PromptChainProps {
  /** Session ID to restore (e.g. from the Previous Chats tab), if any */
  restoreSessionId?: string | null;
  /** Called once the restore has been applied, so the parent can clear it */
  onRestoreConsumed?: () => void;
}

export default function PromptChain({
  restoreSessionId,
  onRestoreConsumed,
}: PromptChainProps) {
  const { sessionId, history, resetSession } = useSession({
    tab: "prompt-chaining",
    restoreSessionId,
    onRestoreConsumed,
  });
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // This tab runs a single-shot workflow (outline → gate → document), not
  // an ongoing back-and-forth chat like the augmented LLM tab. Once one run
  // has produced a result — either just now, or restored from a previous
  // session — the input locks; "Reset chat" starts a fresh run.
  const hasRun = chatHistory.length > 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChatHistory(history);
  }, [history]);

  const { completion, complete, isLoading, error } = useCompletion({
    api: "/api/prompt-chain",
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
        avatarContent="🔗"
        avatarColor="bg-purple-600"
        title="Workflow: Prompt chaining"
        subtitle="Outline (web search) → gate check (code) → full document"
        isLoading={isLoading}
        onReset={handleReset}
      />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {chatHistory.length === 0 && !isLoading && (
            <div className="text-center py-16">
              <div className="text-4xl mb-4">🔗</div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-zinc-300 mb-2">
                Prompt chaining: outline → gate → document
              </h3>
              <p className="text-sm text-gray-500 dark:text-zinc-500 max-w-md mx-auto mb-4">
                Give it a topic. Step 1 drafts an outline using web search for
                grounding. Step 2 runs a plain, deterministic code check on
                section count, length, and leftover placeholders — no LLM
                judgment involved — sending the outline back for one revision
                if it fails. Step 3 writes the full document from the
                approved outline.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="text-xs px-3 py-1.5 rounded-full border border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
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
                <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 flex-shrink-0">
                  🔗
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-purple-600 text-white rounded-br-sm"
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
              avatarContent="🔗"
              avatarColor="bg-purple-600"
              cursorColor="bg-purple-500"
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
        placeholder="Give it a topic for a document… (Enter to send, Shift+Enter for newline)"
        focusRingColor="focus:ring-purple-500"
        sendButtonColor="bg-purple-600"
        sendButtonHoverColor="hover:bg-purple-700"
        footerNote={
          hasRun
            ? "This workflow runs once per topic — click \"Reset chat\" above to start a new run"
            : "Prompt chaining: outline (web search) → gate check (code) → document"
        }
      />
    </div>
  );
}


