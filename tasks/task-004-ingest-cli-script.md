---
id: task-004-ingest-cli-script
title: npm run dashboard:ingest CLI + idempotency proof
assignee: engineer
status: completed
priority: high
createdAt: 2026-05-26T00:45:00Z
startedAt: 2026-05-27T00:25:00Z
completedAt: 2026-05-27T00:33:00Z
pr: https://github.com/colin-prologue/AgentTest/pull/5
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

- 2026-05-27: approved by reviewer. All 9 acceptance criteria met; full vitest suite 13/13 passes (5 db + 5 ingest + 3 cli), typecheck clean. Review file: `tasks/task-004-review.md`. Verdict posted to PR #5 as `--comment` review (account constraint — cannot self-approve).
- 2026-05-27: tester re-verified on PR branch at commit `2e5414e` (`npm install --prefix dashboard && npm test` → vitest 13/13 pass in 4.87s; `npm run typecheck --prefix dashboard` clean). All 9 acceptance criteria checked against code. Merged PR #5 to `claude/ecstatic-gates-oHkEg` via `gh pr merge --squash --delete-branch`; merge commit `55f2921`. Layer 1 (event store + ingest) is now complete on trunk. See `tasks/task-004-verified.md`.
