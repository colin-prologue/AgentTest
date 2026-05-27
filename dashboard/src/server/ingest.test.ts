/**
 * Integration test for the tail-ingest worker.
 *
 * Uses a tmp events dir so we never collide with the real `events/` stream
 * from a running agent process. The AC text references "events/test-ingest.jsonl"
 * — we honor the spirit (a fixture jsonl file named `test-ingest.jsonl`) and
 * read/clean it from an isolated tmpdir to keep this test deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDb, type AgentEvent, type Database } from "./db.js";
import { startIngest } from "./ingest.js";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeEvent(id: string, ts: string): AgentEvent {
  return {
    event_id: id,
    agent_id: "engineer",
    ts,
    type: "tick_start",
    payload: { test: true, id },
  };
}

function eventCount(db: Database): number {
  const row = db.prepare<[], { c: number }>("SELECT COUNT(*) as c FROM events").get();
  return row?.c ?? 0;
}

function offsetFor(db: Database, file: string): number | undefined {
  const row = db
    .prepare<[string], { offset: number }>("SELECT offset FROM ingest_offsets WHERE file = ?")
    .get(file);
  return row?.offset;
}

describe("dashboard ingest worker", () => {
  let workDir: string;
  let eventsDir: string;
  let dbPath: string;
  let fixturePath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "ingest-test-"));
    eventsDir = join(workDir, "events");
    dbPath = join(workDir, "events.db");
    fixturePath = join(eventsDir, "test-ingest.jsonl");
    // beforeEach gets a fresh workDir, so we just need to create the events subdir.
    rmSync(eventsDir, { recursive: true, force: true });
    writeFileSync(join(workDir, ".keep"), ""); // touch workDir
  });

  afterEach(() => {
    if (existsSync(fixturePath)) unlinkSync(fixturePath);
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  });

  it("ingests existing lines, picks up appends, and survives restart without re-reading", async () => {
    // The events dir might not exist at start; the worker should tolerate that.
    // We create it just-in-time below.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(eventsDir, { recursive: true });

    // Initial fixture: 3 events.
    const initial = [
      makeEvent("task003test_e1", "2026-05-27T00:00:00.000Z"),
      makeEvent("task003test_e2", "2026-05-27T00:00:01.000Z"),
      makeEvent("task003test_e3", "2026-05-27T00:00:02.000Z"),
    ];
    writeFileSync(fixturePath, initial.map((e) => JSON.stringify(e)).join("\n") + "\n");

    let db = openDb(dbPath);
    let w = startIngest({ db, eventsDir, pollMs: 100 });
    await wait(800);
    expect(eventCount(db)).toBe(3);

    // Append 2 more.
    const more = [
      makeEvent("task003test_e4", "2026-05-27T00:00:03.000Z"),
      makeEvent("task003test_e5", "2026-05-27T00:00:04.000Z"),
    ];
    appendFileSync(fixturePath, more.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await wait(800);
    expect(eventCount(db)).toBe(5);

    // Capture the offset for resume verification later.
    const offsetAfterFive = offsetFor(db, fixturePath);
    expect(offsetAfterFive).toBeGreaterThan(0);

    await w.stop();
    db.close();

    // Recreate worker pointing at the same db file + same events dir.
    // It must NOT re-read the existing 5 lines (idempotency from INSERT OR IGNORE
    // would mask a re-read, but the offset machinery is what we're testing here).
    db = openDb(dbPath);
    // Sanity: offset row carried over from the previous run.
    expect(offsetFor(db, fixturePath)).toBe(offsetAfterFive);

    w = startIngest({ db, eventsDir, pollMs: 100 });
    await wait(500);
    expect(eventCount(db)).toBe(5);
    await w.stop();
    db.close();
  });

  it("skips malformed JSON lines without crashing or stalling", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(eventsDir, { recursive: true });

    const lines: string[] = [
      JSON.stringify(makeEvent("task003test_bad1", "2026-05-27T00:00:00.000Z")),
      "{this is not valid json",
      JSON.stringify(makeEvent("task003test_bad2", "2026-05-27T00:00:01.000Z")),
    ];
    writeFileSync(fixturePath, lines.join("\n") + "\n");

    const db = openDb(dbPath);
    const w = startIngest({ db, eventsDir, pollMs: 100 });
    await wait(500);

    expect(eventCount(db)).toBe(2);
    // Offset should have advanced past the bad line, not parked on it.
    const off = offsetFor(db, fixturePath);
    expect(off).toBeGreaterThan(0);

    // Subsequent tick should not re-process anything (already at EOF).
    await wait(300);
    expect(eventCount(db)).toBe(2);
    expect(offsetFor(db, fixturePath)).toBe(off);

    await w.stop();
    db.close();
  });

  it("discovers files that appear after start", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(eventsDir, { recursive: true });

    const db = openDb(dbPath);
    const w = startIngest({ db, eventsDir, pollMs: 100 });

    // Wait one tick so the worker is running with no files present.
    await wait(200);
    expect(eventCount(db)).toBe(0);

    // File appears now.
    const later = join(eventsDir, "test-late.jsonl");
    writeFileSync(
      later,
      [makeEvent("task003test_late1", "2026-05-27T00:00:00.000Z")].map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    await wait(500);
    expect(eventCount(db)).toBe(1);

    await w.stop();
    db.close();
    if (existsSync(later)) unlinkSync(later);
  });

  it("handles a partial trailing line: leaves it un-ingested until newline arrives", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(eventsDir, { recursive: true });

    // Write one complete line + a partial (no trailing newline).
    const partial = JSON.stringify(makeEvent("task003test_partial", "2026-05-27T00:00:01.000Z"));
    writeFileSync(
      fixturePath,
      JSON.stringify(makeEvent("task003test_p1", "2026-05-27T00:00:00.000Z")) + "\n" + partial,
    );

    const db = openDb(dbPath);
    const w = startIngest({ db, eventsDir, pollMs: 100 });
    await wait(400);

    // Only the complete line should be ingested.
    expect(eventCount(db)).toBe(1);

    // Complete the partial by appending the newline.
    appendFileSync(fixturePath, "\n");
    await wait(400);
    expect(eventCount(db)).toBe(2);

    await w.stop();
    db.close();
  });

  it("stop() is safe to call before any tick completes", async () => {
    const db = openDb(dbPath);
    const w = startIngest({ db, eventsDir, pollMs: 100 });
    // Immediately stop — no events, no eventsDir even.
    await w.stop();
    db.close();
  });
});
