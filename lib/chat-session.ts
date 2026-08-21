import type Database from "better-sqlite3";

/**
 * Ensures a chat session exists in the DB, creating it (tagged with the
 * building-block tab it belongs to) if necessary. Saves the user prompt as a
 * message if provided. Returns the full conversation history for the
 * session, ready to hand to `streamText`/`generateText`.
 */
export function initChatSession(
  db: Database.Database,
  sessionId: string,
  tab: string,
  prompt?: string,
): { role: "user" | "assistant"; content: string }[] {
  const existingSession = db
    .prepare("SELECT id FROM chat_sessions WHERE id = ?")
    .get(sessionId);

  if (!existingSession) {
    db.prepare("INSERT INTO chat_sessions (id, tab) VALUES (?, ?)").run(
      sessionId,
      tab,
    );
  }

  if (prompt) {
    db.prepare(
      "INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)",
    ).run(sessionId, "user", prompt);
  }

  const history = db
    .prepare(
      "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId) as { role: string; content: string }[];

  return history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}

/**
 * Saves the assistant's response and bumps the session's updated_at
 * timestamp (used to sort the "Previous Chats" list by recency).
 * Only writes if text is non-empty.
 */
export function saveAssistantMessage(
  db: Database.Database,
  sessionId: string,
  text: string,
): void {
  if (!text) return;

  db.prepare(
    "INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)",
  ).run(sessionId, "assistant", text);

  db.prepare(
    "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?",
  ).run(sessionId);
}
