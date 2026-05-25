---
id: task-003-tail-ingest-worker
title: Tail-ingest worker with offset resume
assignee: engineer
status: unstarted
priority: high
createdAt: 2026-05-26T00:45:00Z
dependsOn: [task-002-sqlite-events-schema]
---

## Requirements

Build the worker that watches `events/*.jsonl` and streams new lines into the SQLite store created in task-002. The worker must survive restarts by tracking the last-read byte offset per file in the `ingest_offsets` table.

This task delivers the worker as an **importable module**; the CLI wrapper that runs it is task-004.

## Acceptance Criteria

- [ ] `dashboard/src/server/ingest.ts` exports `startIngest({ db, eventsDir, pollMs? }): { stop(): Promise<void> }`.
- [ ] On start, it scans `events/*.jsonl`, reads the saved offset for each file from `ingest_offsets`, and resumes from there (offset 0 if the file is new).
- [ ] After each batch of lines parsed, the worker writes the new offset back **atomically with** the event inserts (single SQLite transaction per file per tick).
- [ ] Watches for new lines using either `fs.watch` or polling with a configurable interval (default 500 ms). New events should land in SQLite within **1 second** of being appended.
- [ ] Handles malformed JSON lines by logging the parse error and the file+offset, then advancing past that line (does not crash, does not retry the same bad line forever).
- [ ] Discovers new `events/*.jsonl` files that appear after start (a new agent coming online).
- [ ] `stop()` flushes any in-flight transaction and resolves cleanly.
- [ ] Vitest integration test: write a fixture `events/test-ingest.jsonl` with 3 events, run the worker for ~1.5s, assert 3 rows in db, append 2 more events, assert 5 rows total. Then `stop()`, recreate the worker pointing at the same db file, assert it does NOT re-read the first 5 events.
- [ ] Test cleans up `events/test-ingest.jsonl` after running.

## Notes
