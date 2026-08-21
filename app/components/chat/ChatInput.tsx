"use client";

import { useEffect, useRef } from "react";

// ─── Chat Input ───────────────────────────────────────────────────────────────

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  /**
   * Disables the input independent of `isLoading` — e.g. for single-shot
   * workflows (like prompt chaining) that should lock input once the one
   * run has finished, rather than allow a follow-up message like a chat
   * would. Unlike `isLoading`, this does not trigger the send button's
   * spinner.
   */
  disabled?: boolean;
  placeholder?: string;
  /** Tailwind focus ring color class, e.g. "focus:ring-blue-500" */
  focusRingColor?: string;
  /** Tailwind bg color class for the send button, e.g. "bg-blue-600" */
  sendButtonColor?: string;
  /** Tailwind hover bg color class for the send button, e.g. "hover:bg-blue-700" */
  sendButtonHoverColor?: string;
  /** Footer note shown below the input */
  footerNote?: string;
}

export default function ChatInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  disabled = false,
  placeholder = "Type a message… (Enter to send, Shift+Enter for newline)",
  focusRingColor = "focus:ring-blue-500",
  sendButtonColor = "bg-blue-600",
  sendButtonHoverColor = "hover:bg-blue-700",
  footerNote,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDisabled = isLoading || disabled;

  // Focus the input on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Re-focus after loading completes (i.e. after a message is sent) —
  // unless the input has been disabled outright (e.g. a finished
  // single-shot workflow), in which case there's nothing to focus back to.
  useEffect(() => {
    if (!isLoading && !disabled) {
      textareaRef.current?.focus();
    }
  }, [isLoading, disabled]);

  return (
    <div className="bg-white dark:bg-zinc-800 border-t border-gray-200 dark:border-zinc-700 px-4 py-4">
      <div className="max-w-3xl mx-auto">
        <form onSubmit={onSubmit} className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder={placeholder}
            rows={1}
            disabled={isDisabled}
            className={`flex-1 resize-none rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 ${focusRingColor} disabled:opacity-50 max-h-32 overflow-y-auto`}
            style={{ minHeight: "48px" }}
          />
          <button
            type="submit"
            disabled={isDisabled || !value.trim()}
            className={`flex-shrink-0 w-11 h-11 rounded-xl ${sendButtonColor} text-white flex items-center justify-center ${sendButtonHoverColor} disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
          >
            {isLoading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5"
              >
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            )}
          </button>
        </form>
        {footerNote && (
          <p className="text-xs text-gray-400 dark:text-zinc-600 mt-2 text-center">
            {footerNote}
          </p>
        )}
      </div>
    </div>
  );
}
