"use client";

import { useCallback, useEffect, useState } from "react";
import { TAB_META, type MainTab } from "@/app/components/TabNavigation";

// ─── Previous Chats ───────────────────────────────────────────────────────────
// Memory building block: lists every saved chat session (across all
// building-block tabs), which tab it came from, and lets the user click one
// to restore it — navigating back to that tab with the full history loaded.

interface SessionSummary {
  sessionId: string;
  tab: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string | null;
}

interface PreviousChatsProps {
  onRestoreChat: (tab: MainTab, sessionId: string) => void;
  /**
   * Whether this tab is currently the active/visible tab. Since the
   * component stays mounted (just hidden) when switching tabs, this is
   * used to re-fetch the session list every time the user navigates back
   * to this tab, rather than only once on mount.
   */
  isActive: boolean;
}

function formatRelativeTime(isoDate: string): string {
  // SQLite datetime('now') returns UTC without a 'Z' suffix — normalize so
  // Date parses it as UTC rather than local time.
  const date = new Date(isoDate.includes("Z") ? isoDate : `${isoDate}Z`);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function PreviousChats({ onRestoreChat, isActive }: PreviousChatsProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(() => {
    setIsLoading(true);
    setError(null);
    fetch("/api/sessions")
      .then((res) => res.json())
      .then((data: { sessions: SessionSummary[] }) => {
        setSessions(data.sessions ?? []);
      })
      .catch(() => setError("Failed to load previous chats."))
      .finally(() => setIsLoading(false));
  }, []);

  // Re-fetch every time this tab becomes the active tab (not just on first
  // mount), so navigating back here always shows the latest chats.
  useEffect(() => {
    if (isActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchSessions();
    }
  }, [isActive, fetchSessions]);

  return (
    <div className="flex flex-col h-[calc(100vh-146px)] overflow-y-auto bg-gray-50 dark:bg-zinc-900 px-4 py-6">
      <div className="max-w-3xl mx-auto w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Previous Chats
          </h2>
          <button
            onClick={fetchSessions}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-40 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>

        {isLoading && (
          <div className="text-sm text-gray-500 dark:text-zinc-500 text-center py-12">
            Loading previous chats…
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {!isLoading && !error && sessions.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🕘</div>
            <h3 className="text-lg font-semibold text-gray-700 dark:text-zinc-300 mb-2">
              No chats yet
            </h3>
            <p className="text-sm text-gray-500 dark:text-zinc-500 max-w-md mx-auto">
              Start a conversation in one of the building-block tabs and
              it&apos;ll show up here, ready to resume.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {sessions.map((session) => {
            const meta = (TAB_META as Record<string, { label: string; icon: string } | undefined>)[
              session.tab
            ];
            return (
              <button
                key={session.sessionId}
                onClick={() => onRestoreChat(session.tab as MainTab, session.sessionId)}
                className="text-left bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex-shrink-0">
                    {meta?.icon ?? "💬"} {meta?.label ?? session.tab}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-zinc-500 flex-shrink-0">
                    {formatRelativeTime(session.updatedAt)}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-zinc-300 mt-2 line-clamp-2">
                  {session.preview ?? "(empty conversation)"}
                </p>
                <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1 font-mono">
                  {session.messageCount} message
                  {session.messageCount !== 1 ? "s" : ""} · {session.sessionId.slice(0, 12)}…
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
