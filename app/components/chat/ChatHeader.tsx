"use client";

// ─── Chat Header ──────────────────────────────────────────────────────────────

interface ChatHeaderProps {
  /** Avatar content (text like "AI" or an emoji like "🛠") */
  avatarContent: React.ReactNode;
  /** Tailwind bg color class for the avatar, e.g. "bg-blue-600" */
  avatarColor: string;
  title: string;
  subtitle?: string;
  isLoading: boolean;
  onReset: () => void;
}

export default function ChatHeader({
  avatarContent,
  avatarColor,
  title,
  subtitle,
  isLoading,
  onReset,
}: ChatHeaderProps) {
  return (
    <div className="bg-white dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700 px-6 py-4">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-full ${avatarColor} flex items-center justify-center text-white text-sm font-bold`}
          >
            {avatarContent}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Reset button */}
        <button
          onClick={onReset}
          disabled={isLoading}
          title="Reset chat"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-3.5 h-3.5"
          >
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
              clipRule="evenodd"
            />
          </svg>
          Reset chat
        </button>
      </div>
    </div>
  );
}
