import Database from "better-sqlite3";

let db: Database.Database | null = null;

// ─── In-memory SQLite database ────────────────────────────────────────────────
// Mirrors the pattern used in the ai-agent-tutorial reference project: a
// single in-memory SQLite instance shared across API routes for the lifetime
// of the server process. This gives the augmented LLM (and future building
// blocks) durable-within-session chat memory without needing an external
// database.

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Each chat session belongs to exactly one building-block tab (e.g.
  // "augmented-llm"), so the history view can show which tab a chat came
  // from and restore it into the right place.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      tab TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    )
  `);

  return db;
}
