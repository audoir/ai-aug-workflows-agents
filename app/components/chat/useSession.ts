"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/app/components/chat/types";

// ─── useSession ───────────────────────────────────────────────────────────────
// Manages a chat session backed by the server-side (in-memory SQLite) session
// store. On mount, either restores an existing session's history (when
// `restoreSessionId` is provided — e.g. the user clicked a previous chat) or
// creates a brand-new session tagged with `tab`. `resetSession` always starts
// a fresh session.

interface UseSessionOptions {
  /** The building-block tab this session belongs to, e.g. "augmented-llm" */
  tab: string;
  /** If provided, restore this existing session's history instead of creating a new one */
  restoreSessionId?: string | null;
  /** Called once the restore/creation for `restoreSessionId` has been applied */
  onRestoreConsumed?: () => void;
}

export function useSession({
  tab,
  restoreSessionId,
  onRestoreConsumed,
}: UseSessionOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);

  // Tracks whether a session has already been created/restored for this
  // mount. Without this, clearing `restoreSessionId` back to null right
  // after a restore finishes (see below) would leave the effect thinking no
  // session exists yet and spuriously create a brand-new one, overwriting
  // the one that was just restored.
  const initializedRef = useRef(false);
  // Guards against a stale restore response overwriting a newer one if the
  // user restores a second chat before the first request finishes.
  const latestRequestIdRef = useRef(0);

  const createSession = useCallback(() => {
    initializedRef.current = true;
    latestRequestIdRef.current += 1;
    setSessionId(null);
    setHistory([]);
    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab }),
    })
      .then((res) => res.json())
      .then((data: { sessionId: string }) => setSessionId(data.sessionId))
      .catch(() => {
        // Fallback: shouldn't happen in practice, but keeps the UI unblocked
        setSessionId(`session_${Date.now()}_fallback`);
      });
  }, [tab]);

  const restoreSession = useCallback((id: string, onDone?: () => void) => {
    initializedRef.current = true;
    const requestId = (latestRequestIdRef.current += 1);
    setSessionId(null);
    setHistory([]);
    fetch(`/api/session?sessionId=${encodeURIComponent(id)}`)
      .then((res) => res.json())
      .then((data: { sessionId: string; messages: ChatMessage[] }) => {
        if (latestRequestIdRef.current !== requestId) return; // stale response
        setHistory(data.messages ?? []);
        setSessionId(data.sessionId);
      })
      .catch(() => {
        if (latestRequestIdRef.current !== requestId) return;
        setSessionId(id);
      })
      .finally(() => {
        // Only signal that the restore has been consumed once it has
        // actually settled. Signaling this synchronously (before the
        // session id is set) would let the parent clear
        // `restoreSessionId` while `sessionId` is still momentarily null,
        // which previously caused this effect to fire again and create an
        // unrelated brand-new session instead of continuing the restored one.
        if (latestRequestIdRef.current === requestId) onDone?.();
      });
  }, []);

  // On mount (and whenever a new restoreSessionId comes in), either restore
  // the requested session or create a fresh one.
  useEffect(() => {
    if (restoreSessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      restoreSession(restoreSessionId, onRestoreConsumed);
    } else if (!initializedRef.current) {
      createSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreSessionId]);

  return { sessionId, history, resetSession: createSession };
}
