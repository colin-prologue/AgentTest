/**
 * `npm run dashboard:ingest` — foreground ingest CLI (task-004).
 *
 * Wraps `startIngest` (task-003). Provides:
 *   - One-shot startup banner.
 *   - Stat line every 1 s: `dashboard:ingest: ingested N events, watching M files`.
 *   - Clean SIGINT/SIGTERM shutdown: stops the worker, closes the db,
 *     removes the pidfile, prints `dashboard:ingest stopped`, exits 0.
 *   - Pidfile lock at `dashboard/data/ingest.pid`. A second instance refuses
 *     to start if the recorded PID is alive; a stale pidfile (PID not alive)
 *     is silently overwritten.
 *
 * Path overrides via env vars (used by the e2e test for isolation):
 *   INGEST_DB_PATH        absolute path to the SQLite db
 *   INGEST_EVENTS_DIR     directory containing *.jsonl event streams
 *   INGEST_PID_FILE       path to the pidfile
 *   INGEST_POLL_MS        worker poll interval (default 500)
 *   INGEST_STAT_MS        stat-line interval (default 1000)
 *
 * Defaults resolve relative to this file so paths are stable regardless of
 * which cwd the npm script is launched from.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb, DEFAULT_DB_PATH, type Database } from "../db.js";
import { startIngest } from "../ingest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(HERE, "..", "..", "..");
const REPO_ROOT = resolve(DASHBOARD_ROOT, "..");
const DEFAULT_EVENTS_DIR = resolve(REPO_ROOT, "events");
const DEFAULT_PID_FILE = resolve(DASHBOARD_ROOT, "data", "ingest.pid");
const DEFAULT_STAT_MS = 1000;

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // signal 0 doesn't deliver — it just checks if the process exists and we
    // have permission to signal it.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission. Either way it's alive.
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function acquirePidLock(pidFile: string): void {
  if (existsSync(pidFile)) {
    const raw = readFileSync(pidFile, "utf8").trim();
    const existingPid = Number.parseInt(raw, 10);
    if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
      console.error(
        `dashboard:ingest already running (pid ${existingPid}, pidfile ${pidFile}); refusing to start a second instance`,
      );
      process.exit(1);
    }
    // Stale — silently overwrite below.
  }
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, String(process.pid));
}

function releasePidLock(pidFile: string, ownerPid: number): void {
  // Only delete the pidfile if it still holds our PID — protects against a
  // race where another instance overwrote ours while we were shutting down.
  try {
    if (!existsSync(pidFile)) return;
    const raw = readFileSync(pidFile, "utf8").trim();
    if (Number.parseInt(raw, 10) === ownerPid) {
      unlinkSync(pidFile);
    }
  } catch {
    // Best-effort cleanup; never block shutdown on this.
  }
}

function countJsonlFiles(dir: string): number {
  try {
    let n = 0;
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".jsonl")) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

function countEvents(db: Database): number {
  const row = db.prepare<[], { c: number }>("SELECT COUNT(*) as c FROM events").get();
  return row?.c ?? 0;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`expected positive integer, got: ${raw}`);
  }
  return n;
}

export function runCli(): void {
  const dbPath = process.env.INGEST_DB_PATH ?? DEFAULT_DB_PATH;
  const eventsDir = process.env.INGEST_EVENTS_DIR ?? DEFAULT_EVENTS_DIR;
  const pidFile = process.env.INGEST_PID_FILE ?? DEFAULT_PID_FILE;
  const pollMs = process.env.INGEST_POLL_MS ? parsePositiveInt(process.env.INGEST_POLL_MS, 500) : undefined;
  const statMs = parsePositiveInt(process.env.INGEST_STAT_MS, DEFAULT_STAT_MS);

  acquirePidLock(pidFile);
  const ownerPid = process.pid;

  console.log(`dashboard:ingest starting (db=${dbPath}, eventsDir=${eventsDir})`);

  const db = openDb(dbPath);
  const worker = startIngest({ db, eventsDir, pollMs });

  const statInterval = setInterval(() => {
    try {
      const events = countEvents(db);
      const files = countJsonlFiles(eventsDir);
      console.log(`dashboard:ingest: ingested ${events} events, watching ${files} files`);
    } catch (err) {
      console.error("dashboard:ingest stat error:", (err as Error).message);
    }
  }, statMs);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    void signal; // signal logged via the message below isn't useful here
    clearInterval(statInterval);
    try {
      await worker.stop();
    } catch (err) {
      console.error("dashboard:ingest worker stop error:", (err as Error).message);
    }
    try {
      db.close();
    } catch {
      // ignore
    }
    releasePidLock(pidFile, ownerPid);
    console.log("dashboard:ingest stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Last-ditch cleanup: if the process exits abnormally (uncaught throw etc.)
  // try to drop the pidfile so future instances aren't blocked on us.
  process.on("exit", () => {
    if (!shuttingDown) releasePidLock(pidFile, ownerPid);
  });
}

// Run when invoked directly (tsx or `npm run dashboard:ingest`).
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const entryUrl = new URL(`file://${entry.replace(/\\/g, "/")}`).href;
    return entryUrl === import.meta.url;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  try {
    runCli();
  } catch (err) {
    console.error("dashboard:ingest fatal:", (err as Error).message);
    process.exit(1);
  }
}
