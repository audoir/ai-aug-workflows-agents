import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// ─── Session API ──────────────────────────────────────────────────────────────
// POST creates a brand-new chat session tagged with the building-block tab it
// belongs to (e.g. "augmented-llm"). GET restores an existing session's full
// message history so a tab can resume a previous conversation.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tab: string = body.tab ?? "augmented-llm";

  const db = getDb();
  const sessionId = randomUUID();

  db.prepare("INSERT INTO chat_sessions (id, tab) VALUES (?, ?)").run(
    sessionId,
    tab,
  );

  return NextResponse.json({ sessionId, tab });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId query parameter is required" },
      { status: 400 },
    );
  }

  const db = getDb();

  const session = db
    .prepare("SELECT id, tab FROM chat_sessions WHERE id = ?")
    .get(sessionId) as { id: string; tab: string } | undefined;

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const messages = db
    .prepare(
      "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId) as { role: "user" | "assistant"; content: string }[];

  return NextResponse.json({
    sessionId: session.id,
    tab: session.tab,
    messages,
  });
}
