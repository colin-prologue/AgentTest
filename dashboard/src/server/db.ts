/**
 * SQLite persistence for the dashboard (Layer 1).
 *
 * - `openDb(path?)` opens a WAL-mode SQLite file and runs migrations on first call.
 * - `insertEvent` is idempotent on `event_id` (INSERT OR IGNORE).
 * - `getEventsSince` returns events strictly after a given event_id (by insertion
 *   order via rowid), with optional `agentId` filter and `limit`.
 *
 * The ingest worker (task-003) will use `ingest_offsets` to remember how far it
 * has read into each `events/*.jsonl` file.
 *
 * NOTE on `parent_event_id`: the hook layer (`agents/shared/hooks.ts`) does not
 * currently populate this field. It is reserved for causality work in a later
 * task and is accepted as nullable here.
 */

import BetterSqlite3, { type Database } from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Local mirror of `AgentEvent` from `agents/shared/events.ts`. Kept in this
 * package to avoid a cross-package source dependency under TS project
 * references. **Keep in sync** with the canonical type — when fields are added
 * upstream, update this declaration and the events table schema below.
 */
export type EventType =
  | "session_start"
  | "session_end"
  | "pre_tool_use"
  | "post_tool_use"
  | "stop"
  | "tick_start"
  | "tick_end"
  | "decision"
  | "handoff"
  | "blocker"
  | "error";

export type AgentEvent = {
  event_id: string;
  parent_event_id?: string;
  agent_id: string;
  session_id?: string;
  task_id?: string;
  ts: string;
  type: EventType;
  payload: Record<string, unknown>;
  blob_ref?: string;
};

const HERE = dirname(fileURLToPath(import.meta.url));
/** dashboard/data/events.db, resolved relative to this file. */
export const DEFAULT_DB_PATH = resolve(HERE, "..", "..", "data", "events.db");

/** Re-exported for callers who want the underlying `Database` type. */
export type { Database } from "better-sqlite3";

/**
 * Schema split into single statements so each one is `prepare`-able.
 * CREATE IF NOT EXISTS is idempotent, so this doubles as the
 * "migrations on boot" step the AC asks for. If we ever need real migrations
 * (column adds, renames) we'll introduce a `schema_version` table and a step
 * runner; for now this is enough.
 */
const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS events (
     event_id        TEXT PRIMARY KEY,
     parent_event_id TEXT,
     agent_id        TEXT NOT NULL,
     session_id      TEXT,
     task_id         TEXT,
     ts              TEXT NOT NULL,
     type            TEXT NOT NULL,
     payload         TEXT NOT NULL,
     blob_ref        TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_events_agent_ts ON events (agent_id, ts)`,
  `CREATE INDEX IF NOT EXISTS idx_events_task_ts  ON events (task_id,  ts)`,
  `CREATE TABLE IF NOT EXISTS ingest_offsets (
     file   TEXT PRIMARY KEY,
     offset INTEGER NOT NULL
   )`,
];

function runMigrations(db: Database): void {
  const tx = db.transaction(() => {
    for (const sql of SCHEMA_STATEMENTS) {
      db.prepare(sql).run();
    }
  });
  tx();
}

/**
 * Open a SQLite database, set WAL mode, and run migrations. Creates parent
 * directories for the database file if they don't exist. Pass `":memory:"`
 * for an in-process db (used in tests).
 */
export function openDb(path: string = DEFAULT_DB_PATH): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new BetterSqlite3(path);
  // WAL is a no-op on `:memory:` but harmless — set it for consistency.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

const INSERT_EVENT_SQL = `
INSERT OR IGNORE INTO events
  (event_id, parent_event_id, agent_id, session_id, task_id, ts, type, payload, blob_ref)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Insert an event. Idempotent on `event_id` — if a row with that id already
 * exists, the call is a no-op and returns false. Returns true on a new insert.
 */
export function insertEvent(db: Database, e: AgentEvent): boolean {
  const stmt = db.prepare(INSERT_EVENT_SQL);
  const result = stmt.run(
    e.event_id,
    e.parent_event_id ?? null,
    e.agent_id,
    e.session_id ?? null,
    e.task_id ?? null,
    e.ts,
    e.type,
    JSON.stringify(e.payload ?? {}),
    e.blob_ref ?? null,
  );
  return result.changes === 1;
}

export interface GetEventsSinceOpts {
  /** Return only events inserted strictly after this event_id. */
  sinceEventId?: string;
  /** Restrict to a single agent. */
  agentId?: string;
  /** Maximum rows to return. Defaults to 1000. */
  limit?: number;
}

interface EventRow {
  event_id: string;
  parent_event_id: string | null;
  agent_id: string;
  session_id: string | null;
  task_id: string | null;
  ts: string;
  type: string;
  payload: string;
  blob_ref: string | null;
}

function rowToEvent(row: EventRow): AgentEvent {
  const out: AgentEvent = {
    event_id: row.event_id,
    agent_id: row.agent_id,
    ts: row.ts,
    type: row.type as EventType,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  };
  if (row.parent_event_id !== null) out.parent_event_id = row.parent_event_id;
  if (row.session_id !== null) out.session_id = row.session_id;
  if (row.task_id !== null) out.task_id = row.task_id;
  if (row.blob_ref !== null) out.blob_ref = row.blob_ref;
  return out;
}

/**
 * Return events in insertion order (by rowid). With `sinceEventId`, returns
 * events whose rowid is strictly greater than that of the referenced event;
 * if the referenced event is not present in the table, returns no rows
 * (callers can detect this and decide how to recover).
 */
export function getEventsSince(
  db: Database,
  opts: GetEventsSinceOpts = {},
): AgentEvent[] {
  const limit = opts.limit ?? 1000;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.sinceEventId !== undefined) {
    conditions.push("rowid > (SELECT rowid FROM events WHERE event_id = ?)");
    params.push(opts.sinceEventId);
  }
  if (opts.agentId !== undefined) {
    conditions.push("agent_id = ?");
    params.push(opts.agentId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM events ${where} ORDER BY rowid ASC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}
