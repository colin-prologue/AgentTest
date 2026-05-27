/**
 * Tail-ingest worker for events/*.jsonl → SQLite (Layer 1, task-003).
 *
 * Polls the events directory at a fixed interval. For each `*.jsonl` file:
 *   1. Look up the byte offset stored in `ingest_offsets`.
 *   2. Read bytes from that offset to end-of-file (synchronously).
 *   3. Split on '\n'; the trailing partial line (if any) is kept and not
 *      counted toward the new offset — we'll see it again next tick once
 *      its newline arrives.
 *   4. Parse each complete line as JSON. Bad lines are logged with file+offset
 *      and skipped (offset advances past them so we never retry).
 *   5. In a single SQLite transaction: insert all parsed events and upsert the
 *      new offset. Idempotency lives in `insertEvent` (INSERT OR IGNORE on
 *      `event_id`), so re-reading any prefix of the file is a no-op.
 *
 * Files that appear after start are discovered on the next tick. Files that
 * disappear are skipped silently — the offset row stays in case the file
 * comes back later.
 */

import { openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { insertEvent, type AgentEvent } from "./db.js";

export interface StartIngestOpts {
  db: Database;
  /** Directory containing `*.jsonl` event streams. */
  eventsDir: string;
  /** Poll interval in ms; default 500. */
  pollMs?: number;
}

export interface IngestHandle {
  /** Stop the poller. Waits for any in-flight tick to finish. */
  stop(): Promise<void>;
  /** Force-run one tick now. Exposed for tests; production code shouldn't need it. */
  tickNow(): void;
}

const DEFAULT_POLL_MS = 500;

const SELECT_OFFSET_SQL = "SELECT offset FROM ingest_offsets WHERE file = ?";
const UPSERT_OFFSET_SQL =
  "INSERT INTO ingest_offsets (file, offset) VALUES (?, ?) " +
  "ON CONFLICT(file) DO UPDATE SET offset = excluded.offset";

interface ParseOutcome {
  events: AgentEvent[];
  newOffset: number;
}

function readNewBytes(filePath: string, startOffset: number): { content: string; endOfFile: number } | undefined {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return undefined; // file vanished mid-tick — skip silently
  }
  if (size <= startOffset) return { content: "", endOfFile: size };

  const bytesToRead = size - startOffset;
  const buffer = Buffer.alloc(bytesToRead);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buffer, 0, bytesToRead, startOffset);
  } finally {
    closeSync(fd);
  }
  return { content: buffer.toString("utf8"), endOfFile: size };
}

function parseLines(content: string, fileEndOffset: number, fileLabel: string): ParseOutcome {
  const lines = content.split("\n");
  // The last chunk after the final '\n' is either "" (file ends with \n) or a partial line.
  // We do NOT process partials; we'll see the full line next tick.
  const partial = lines.pop() ?? "";
  const partialBytes = Buffer.byteLength(partial, "utf8");
  const newOffset = fileEndOffset - partialBytes;

  const events: AgentEvent[] = [];
  for (const line of lines) {
    if (line.length === 0) continue; // blank line, skip
    try {
      const parsed = JSON.parse(line) as AgentEvent;
      events.push(parsed);
    } catch (err) {
      // Advance past bad lines — don't retry forever. AC requires this.
      console.error(
        `ingest: malformed JSON in ${fileLabel} (skipping): ${(err as Error).message}`,
      );
    }
  }
  return { events, newOffset };
}

function processFile(db: Database, filePath: string): void {
  const fileKey = resolve(filePath);
  const offsetRow = db
    .prepare<[string], { offset: number }>(SELECT_OFFSET_SQL)
    .get(fileKey);
  const startOffset = offsetRow?.offset ?? 0;

  const read = readNewBytes(fileKey, startOffset);
  if (read === undefined) return;
  if (read.content.length === 0 && read.endOfFile === startOffset) return;

  const { events, newOffset } = parseLines(read.content, read.endOfFile, fileKey);

  // Atomic batch: all events for this file + the offset bump live in one tx.
  // Even if the process is killed mid-write, SQLite WAL guarantees we either
  // see all-or-none. INSERT OR IGNORE in insertEvent means a partial replay
  // after crash is still safe.
  const tx = db.transaction(() => {
    for (const event of events) {
      insertEvent(db, event);
    }
    db.prepare(UPSERT_OFFSET_SQL).run(fileKey, newOffset);
  });
  tx();
}

function listJsonlFiles(eventsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(eventsDir);
  } catch {
    return []; // dir may not exist yet
  }
  const files: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    files.push(join(eventsDir, name));
  }
  return files;
}

export function startIngest(opts: StartIngestOpts): IngestHandle {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  let stopped = false;
  let currentTimer: NodeJS.Timeout | undefined;
  // tick() is synchronous, but we expose stop() as async so callers can await
  // a clean shutdown. `inFlight` resolves after each tick completes.
  let inFlight: Promise<void> | undefined;

  function tick(): void {
    if (stopped) return;
    for (const file of listJsonlFiles(opts.eventsDir)) {
      try {
        processFile(opts.db, file);
      } catch (err) {
        console.error(`ingest: error processing ${file}:`, err);
      }
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    currentTimer = setTimeout(loop, pollMs);
  }

  function loop(): void {
    if (stopped) return;
    inFlight = new Promise<void>((resolveTick) => {
      try {
        tick();
      } catch (err) {
        console.error("ingest: tick error", err);
      } finally {
        resolveTick();
      }
    });
    inFlight.then(() => {
      inFlight = undefined;
      scheduleNext();
    });
  }

  // Run the first tick immediately so any events present at startup land in
  // the DB without waiting one full pollMs.
  loop();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (currentTimer !== undefined) {
        clearTimeout(currentTimer);
        currentTimer = undefined;
      }
      if (inFlight !== undefined) await inFlight;
    },
    tickNow(): void {
      tick();
    },
  };
}
