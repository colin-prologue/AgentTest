---
id: task-004-ingest-cli-script
title: npm run dashboard:ingest CLI + idempotency proof
assignee: engineer
status: in_progress
priority: high
createdAt: 2026-05-26T00:45:00Z
startedAt: 2026-05-27T00:25:00Z
dependsOn: [task-003-tail-ingest-worker]
---

## Requirements

Wrap the ingest worker (task-003) in a CLI entry point. Running `npm run dashboard:ingest` from the repo root should start ingest in the foreground, log a single startup line, and stream a one-line summary every second (e.g. "ingested N events, watching M files"). Ctrl-C must shut down cleanly. Also: add a pidfile lock so a second instance refuses to start.

## Acceptance Criteria

- [ ] `dashboard/src/server/cli/ingest.ts` is an executable entry that calls `startIngest(...)` from task-003.
- [ ] Root `package.json` (or `dashboard/package.json`, whichever is invoked) exposes `npm run dashboard:ingest`.
- [ ] On startup: prints `dashboard:ingest starting (db=<path>, eventsDir=<path>)` once, then a periodic stat line every 1 s while running.
- [ ] On SIGINT (Ctrl-C): calls `stop()` on the worker, waits for it, prints `dashboard:ingest stopped`, exits 0.
- [ ] Writes a pidfile to `dashboard/data/ingest.pid` on start; deletes it on clean shutdown.
- [ ] If the pidfile exists AND the recorded PID is alive, refuse to start with a non-zero exit and a clear message.
- [ ] Stale pidfile (PID not alive) is silently overwritten.
- [ ] **Idempotency proof**: a vitest e2e test that (a) writes 5 events to `events/test-cli.jsonl`, (b) spawns the CLI as a child process, (c) waits ~1.5 s, (d) sends SIGINT, (e) asserts the db has 5 rows, (f) spawns the CLI again on the same db + same file, (g) waits ~1.5 s, (h) sends SIGINT, (i) asserts the db still has exactly 5 rows (no duplicates). Cleans up the fixture file.

## Notes
