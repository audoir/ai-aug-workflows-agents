"use client";

// ─── Typing Indicator ─────────────────────────────────────────────────────────

export function TypingIndicator() {
  return (
    <div className="flex gap-1 items-center py-1">
      <span
        className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
        style={{ animationDelay: "300ms" }}
      />
    </div>
  );
}

// ─── Streaming Message ────────────────────────────────────────────────────────

interface StreamingMessageProps {
  completion: string;
  /** Avatar content (text like "AI" or an emoji like "🛠") */
  avatarContent: React.ReactNode;
  /** Tailwind bg color class for the avatar, e.g. "bg-blue-600" */
  avatarColor: string;
  /** Tailwind bg color class for the cursor pulse, e.g. "bg-blue-500" */
  cursorColor?: string;
}

export function StreamingMessage({
  completion,
  avatarContent,
  avatarColor,
  cursorColor = "bg-blue-500",
}: StreamingMessageProps) {
  return (
    <div className="flex justify-start">
      <div
        className={`w-7 h-7 rounded-full ${avatarColor} flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 flex-shrink-0`}
      >
        {avatarContent}
      </div>
      <div className="max-w-[75%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed bg-white dark:bg-zinc-800 text-gray-900 dark:text-white border border-gray-200 dark:border-zinc-700">
        {completion ? (
          <p className="whitespace-pre-wrap">
            {completion}
            <span
              className={`inline-block w-2 h-4 ml-1 ${cursorColor} animate-pulse align-middle rounded-sm`}
            />
          </p>
        ) : (
          <TypingIndicator />
        )}
      </div>
    </div>
  );
}

// ─── Error Message ────────────────────────────────────────────────────────────

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-400 text-sm">
      Error: {message}
    </div>
  );
}
