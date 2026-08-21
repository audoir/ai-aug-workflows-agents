import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// ─── Sessions list API ────────────────────────────────────────────────────────
// Powers the "Previous Chats" tab: lists every chat session that has at least
// one message, along with which building-block tab it belongs to, a preview
// of the first user message, and the message count — ordered most-recent-first.

interface SessionRow {
  id: string;
  tab: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  preview: string | null;
}

export async function GET() {
  const db = getDb();

  const sessions = db
    .prepare(
      `SELECT
        s.id,
        s.tab,
        s.created_at,
        s.updated_at,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
        (SELECT content FROM chat_messages m
          WHERE m.session_id = s.id AND m.role = 'user'
          ORDER BY m.created_at ASC LIMIT 1) AS preview
      FROM chat_sessions s
      WHERE (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) > 0
      ORDER BY s.updated_at DESC`,
    )
    .all() as SessionRow[];

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      sessionId: s.id,
      tab: s.tab,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      messageCount: s.message_count,
      preview: s.preview,
    })),
  });
}
