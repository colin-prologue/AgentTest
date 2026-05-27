---
id: task-002-sqlite-events-schema
title: SQLite schema + db.ts module for AgentEvent
assignee: engineer
status: completed
priority: high
createdAt: 2026-05-26T00:45:00Z
startedAt: 2026-05-25T22:50:00Z
completedAt: 2026-05-27T00:07:00Z
pr: https://github.com/colin-prologue/AgentTest/pull/3
dependsOn: [task-001-dashboard-skeleton]
---

## Requirements

Add the persistence layer for Layer 1. Create a SQLite database at `dashboard/data/events.db` (WAL mode) with a schema that maps the canonical `AgentEvent` type from `agents/shared/events.ts`. Expose a small typed module (`dashboard/src/server/db.ts`) that opens the database, runs migrations on boot, and exposes `insertEvent(e)` + `getEventsSince(eventId, opts)` helpers.

No ingest yet (that's task-003). This task only delivers the schema, the connection module, and verifies inserts/queries work via a unit test.

## Acceptance Criteria

- [ ] `dashboard/src/server/db.ts` exports `openDb(path?: string): Database` that opens a SQLite file in WAL mode and runs any pending migrations on first call.
- [ ] Schema includes an `events` table with columns matching `AgentEvent` (`event_id PRIMARY KEY`, `parent_event_id`, `agent_id`, `session_id`, `task_id`, `ts`, `type`, `payload TEXT`, `blob_ref`). Insert is **idempotent** on `event_id` (`INSERT OR IGNORE`).
- [ ] Schema also includes an `ingest_offsets` table (`file TEXT PRIMARY KEY, offset INTEGER NOT NULL`) ready for task-003 to use.
- [ ] Indexes on `(agent_id, ts)` and `(task_id, ts)` for the query patterns Layer 2 will need.
- [ ] Exports `insertEvent(db, e)` and `getEventsSince(db, { sinceEventId?, agentId?, limit? })`.
- [ ] Uses `better-sqlite3` (sync API, simpler for a single-process ingest). Add it as a runtime dep in `dashboard/package.json`.
- [ ] `dashboard/data/` is gitignored (add to `.gitignore`).
- [ ] One vitest unit test (`db.test.ts`): opens an in-memory db, inserts two events, asserts `getEventsSince` returns both, asserts re-inserting the same `event_id` is a no-op.
- [ ] `npm test` (or `npm run test --workspace dashboard`, whatever the layout becomes) passes locally.

## Notes

- 2026-05-26: approved by reviewer. All 8 acceptance criteria met. Verified via `npm install && npm test` and `npm run typecheck` in a clean worktree on `task/task-002-sqlite-events-schema` (commit 12ef4e8) — 5 vitest tests pass, typecheck clean. Review file: `tasks/task-002-review.md`. Verdict posted to PR #3 as a `--comment` review (account constraint — cannot self-approve).
- 2026-05-27: tester re-verified on PR branch at commit 12ef4e8 (`npm install --prefix dashboard && npm test` → vitest 5 passed; `npm run typecheck --prefix dashboard` clean). All 9 acceptance criteria checked against code. Merged PR #3 to `claude/ecstatic-gates-oHkEg` via `gh pr merge --squash --delete-branch`; merge commit `08d1f77`. See `tasks/task-002-verified.md`.
