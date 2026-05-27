# Review — task-002-sqlite-events-schema

Reviewed commit `12ef4e8` on branch `task/task-002-sqlite-events-schema` (PR #3).
Diff: 8 files (`dashboard/src/server/db.ts`, `db.test.ts`, `vitest.config.ts`, `dashboard/package.json`, root `package.json`, `.gitignore`, task file, plus `package-lock.json`).

## Acceptance criteria

### `openDb(path?)` opens WAL-mode SQLite and runs migrations on first call
**Pass.** `openDb` defaults `path` to `DEFAULT_DB_PATH` (`dashboard/data/events.db`, resolved relative to the module), `mkdirSync`s the parent dir when the path isn't `:memory:`, sets `journal_mode = WAL` (plus `foreign_keys = ON`), and calls `runMigrations`, which wraps the `CREATE TABLE IF NOT EXISTS` statements in a transaction. Returns the `Database` handle.

### `events` table schema + idempotent insert
**Pass.** Columns: `event_id PRIMARY KEY`, `parent_event_id`, `agent_id NOT NULL`, `session_id`, `task_id`, `ts NOT NULL`, `type NOT NULL`, `payload TEXT NOT NULL`, `blob_ref`. Matches the `AgentEvent` shape in `agents/shared/events.ts` 1:1. `INSERT OR IGNORE` is used (`INSERT_EVENT_SQL`), and `insertEvent` returns `result.changes === 1` so callers can distinguish a real insert from an idempotent skip — nice touch.

### `ingest_offsets` table
**Pass.** `CREATE TABLE IF NOT EXISTS ingest_offsets (file TEXT PRIMARY KEY, offset INTEGER NOT NULL)` — exactly the shape task-003 will need.

### Indexes on `(agent_id, ts)` and `(task_id, ts)`
**Pass.** `idx_events_agent_ts` and `idx_events_task_ts` are both created.

### Exports `insertEvent(db, e)` and `getEventsSince(db, { sinceEventId?, agentId?, limit? })`
**Pass.** Signatures match. `getEventsSince` orders by `rowid ASC` (insertion order) and defaults `limit` to 1000. The `sinceEventId` filter uses `rowid > (SELECT rowid FROM events WHERE event_id = ?)`; this returns no rows if the referenced event_id isn't present, which is documented in the function comment — reasonable behavior.

### `better-sqlite3` added as runtime dep
**Pass.** `dashboard/package.json` adds `better-sqlite3 ^11.3.0` to `dependencies` and `@types/better-sqlite3 ^7.6.11` to `devDependencies`. `vitest ^2.1.0` added as devDep.

### `dashboard/data/` gitignored
**Pass.** `.gitignore` gains a `# Dashboard runtime` block with `dashboard/data/` and `dashboard/dist/`.

### Vitest unit test (in-memory db, insert two events, idempotent re-insert)
**Pass.** `db.test.ts` covers the required scenarios and goes further:
- inserts two distinct events, asserts `getEventsSince` returns both with the right `event_id`/`task_id`/`session_id`/`payload`;
- re-inserts the same `event_id` with a different payload, asserts `insertEvent` returns `false` and the original payload is preserved (proves `INSERT OR IGNORE`, not `INSERT OR REPLACE`);
- filtering by `sinceEventId` and `agentId` (combined and separate);
- `limit` honored;
- `ingest_offsets` table exists after migrations.
5 tests, all green.

### `npm test` passes locally
**Pass.** Ran `npm install && npm test` in a clean worktree on the branch — vitest reports `5 passed`. Also ran `npm run typecheck` (`tsc -b`) — clean.

## Extra checks
- **Type mirror**: `EventType` and `AgentEvent` in `db.ts` exactly mirror `agents/shared/events.ts`. The comment in the file flags the sync requirement, which is the right tradeoff to avoid a cross-package source dep here.
- **Optional-field round-trip**: `rowToEvent` only sets `parent_event_id`/`session_id`/`task_id`/`blob_ref` when the column is non-null, so optional fields stay `undefined` rather than becoming `null` — matches the canonical `AgentEvent` type.
- **Secrets/auth/untrusted input**: none touched. All SQL is parameterized, `JSON.parse` runs on payloads written by our own ingest layer.
- **Root `npm test`** now delegates to `npm test --prefix dashboard` — convenient for the tester to call from the root.

## Verdict

Approved. Meets every acceptance criterion, tests + typecheck pass clean.
