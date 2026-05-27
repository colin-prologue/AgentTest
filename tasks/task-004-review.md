# Review — task-004-ingest-cli-script

Reviewed `task/task-004-ingest-cli-script` (PR #5). Diff: 4 files (`dashboard/src/server/cli/ingest.ts`, `cli/ingest.test.ts`, root `package.json`, task file).

## Acceptance criteria

### `dashboard/src/server/cli/ingest.ts` is an executable entry that calls `startIngest(...)`
**Pass.** `runCli()` imports `startIngest` from `../ingest.js`, builds `{ db, eventsDir, pollMs }`, and self-invokes via an `import.meta.url`-based check when run directly (tsx or `npm run`). The check normalizes Windows backslashes to forward slashes before comparing — important on this platform.

### Root `package.json` exposes `npm run dashboard:ingest`
**Pass.** `"dashboard:ingest": "tsx dashboard/src/server/cli/ingest.ts"` added to root scripts.

### Startup banner + 1 s stat line
**Pass.** `console.log(\`dashboard:ingest starting (db=${dbPath}, eventsDir=${eventsDir})\`)` runs exactly once after pidlock acquisition. `setInterval(..., statMs)` (default `DEFAULT_STAT_MS = 1000`) logs `dashboard:ingest: ingested N events, watching M files`. `INGEST_STAT_MS` env var overrides the interval — used by tests to accelerate, fine.

### SIGINT → `stop()`, await, print `dashboard:ingest stopped`, exit 0
**Pass.** `shutdown` handler is registered for both SIGINT and SIGTERM, guarded by a `shuttingDown` flag (re-entrant SIGINTs no-op). It clears the stat interval, `await`s `worker.stop()`, closes the db, drops the pidfile, prints `dashboard:ingest stopped`, then `process.exit(0)`.

### Pidfile written to `dashboard/data/ingest.pid` on start, deleted on clean shutdown
**Pass.** `DEFAULT_PID_FILE = resolve(DASHBOARD_ROOT, "data", "ingest.pid")`. `acquirePidLock` `mkdirSync`s the parent and `writeFileSync`s `process.pid`. `releasePidLock` removes it during shutdown — and only if the file still holds our PID, protecting against a race where a second instance overwrote it. The test confirms the pidfile exists between startup and shutdown.

### Live-PID pidfile → refuse with non-zero exit + clear message
**Pass.** `acquirePidLock` reads the pidfile, parses the int, and calls `isProcessAlive` (uses `process.kill(pid, 0)`, treats `EPERM` as alive — correct). If alive, prints `dashboard:ingest already running (pid <N>, pidfile <path>); refusing to start a second instance` to stderr and `process.exit(1)`. The "refuses to start" test seeds the pidfile with `process.pid` of the test runner (guaranteed alive) and asserts non-zero exit + `already running` in output.

### Stale pidfile silently overwritten
**Pass.** Same `acquirePidLock` path: if `isProcessAlive` returns false, falls through to the `writeFileSync` overwrite without logging. The "overwrites a stale pidfile" test seeds `0x7fffff0` (~2.1B, well above any real PID), spawns the CLI, asserts the banner appears, and asserts the file now contains the child's actual PID. Clean.

### Idempotency e2e (5 events → spawn → 1.5 s → SIGINT → assert 5 → respawn → 1.5 s → SIGINT → still 5)
**Pass.** The first test does exactly this. Spawns via `process.execPath --import tsx <script>` directly (no shell wrapper), so `child.pid` is the real Node PID and `kill` targets the right process — important on Windows where a `cmd.exe` wrapper would otherwise orphan node. Uses `mkdtempSync`-isolated paths via the env-var overrides (`INGEST_DB_PATH`, `INGEST_EVENTS_DIR`, `INGEST_PID_FILE`), so the test never touches the real `dashboard/data/` or repo `events/`.

### Cleans up fixture
**Pass.** `afterEach` removes the entire tmp workDir (with a settle+retry to handle Windows EBUSY on the just-closed sqlite file).

## Extra checks
- **Windows SIGINT caveat.** The test file's header openly documents that `child.kill("SIGINT")` on Windows terminates abruptly rather than delivering SIGINT, then argues correctness is preserved by per-batch WAL transactions in the worker plus `INSERT OR IGNORE`. That's the right call — they could have skipped the test on Windows but instead leaned on the durability guarantees to keep coverage. Verified: 3 CLI tests + 10 existing pass on this Windows host.
- **`releasePidLock` race protection.** Only unlinks if the file still contains our PID. Prevents a graceful shutdown from clobbering a freshly-started successor's pidfile.
- **`process.on("exit", ...)` last-ditch cleanup.** Reduces the chance of a stale pidfile after an unhandled throw without depending on signal handlers.
- **Path resolution.** All defaults resolve relative to the source file (`fileURLToPath(import.meta.url)`), so the CLI works regardless of the caller's cwd. The npm script invokes it from the repo root and it still finds `dashboard/data/ingest.pid` correctly.
- **No secrets / auth / untrusted input.** Env vars feed file paths and an integer; the integer goes through `parsePositiveInt` which throws on garbage. SQL is unchanged from earlier tasks.
- **Verification.** `npm install && npm test` → 13 passed (5 db + 5 ingest + 3 cli). `npm run typecheck` clean.

## Verdict

Approved. All 9 acceptance criteria met, with thoughtful Windows-portability handling and useful race-protection on the pidfile that the AC didn't strictly require.
