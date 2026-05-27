# Tester verification — task-004-ingest-cli-script

**PR:** #5
**Head branch verified at commit:** `2e5414e` (`feat(dashboard): ingest CLI with pidfile lock + idempotency proof (task-004)`)
**Base branch:** `claude/ecstatic-gates-oHkEg` (team trunk — not real `main`/`master`, safety check passed)
**Squash-merge commit on trunk:** `55f29211ce386760b14be7cc32520c33fa4328a4`
**Merged at:** 2026-05-27T00:32:06Z

## Pre-merge commands run

```
git fetch origin
git checkout task/task-004-ingest-cli-script          # local had stray commit 4d16d2f
git reset --keep 2e5414e                              # rewind to PR tip (stray preserved on save branch)
npm install --prefix dashboard                         # cached
npm test                                               # delegates to npm test --prefix dashboard
npm run typecheck --prefix dashboard                   # tsc -b, clean
```

## Test results

`npm test` (root → `npm test --prefix dashboard` → `vitest run`):

```
 ✓ src/server/db.test.ts (5 tests) 8ms
 ✓ src/server/cli/ingest.test.ts (3 tests) 4396ms
   ✓ ingests a fixture, shuts down, and re-running on the same db is idempotent  3639ms
   ✓ refuses to start if the pidfile holds a live PID                            353ms
   ✓ overwrites a stale pidfile (PID not alive) and starts normally              403ms
 ✓ src/server/ingest.test.ts (5 tests) 4586ms
   ✓ ingests existing lines, picks up appends, and survives restart without re-reading
   ✓ skips malformed JSON lines without crashing or stalling
   ✓ discovers files that appear after start
   ✓ handles a partial trailing line: leaves it un-ingested until newline arrives
   ✓ stop() is safe to call before any tick completes

 Test Files  3 passed (3)
      Tests  13 passed (13)
   Duration  4.87s
```

The "malformed JSON" test's stderr line (`ingest: malformed JSON in <tmpdir>/events/test-ingest.jsonl (skipping): ...`) is the AC-mandated log path, not a failure.

`npm run typecheck --prefix dashboard`: exit 0, no output (clean).

## Acceptance criteria — verified against PR branch code (`dashboard/src/server/cli/ingest.ts`)

1. **`cli/ingest.ts` is an executable entry that calls `startIngest(...)`.** `runCli()` at `:115`; imports `startIngest` from `../ingest.js` at `:36`; calls it at `:128`. Self-invokes via an `import.meta.url`-vs-`process.argv[1]` check at `:172-181` that normalizes Windows backslashes to forward slashes before comparing. ✅
2. **`npm run dashboard:ingest` script.** Root `package.json` has `"dashboard:ingest": "tsx dashboard/src/server/cli/ingest.ts"`. ✅
3. **Startup banner once + 1 s stat line.** `console.log(\`dashboard:ingest starting (db=${dbPath}, eventsDir=${eventsDir})\`)` at `:125` (runs once, after pidlock). `setInterval(..., statMs)` at `:130-138`; default `DEFAULT_STAT_MS = 1000`. `INGEST_STAT_MS` env override used by tests. ✅
4. **SIGINT → stop, await, print stopped, exit 0.** `shutdown` handler at `:141-159` registered for `SIGINT` and `SIGTERM` at `:161-162`; `shuttingDown` guard makes it re-entrant; clears stat interval, awaits `worker.stop()`, closes db, drops pidfile, prints `dashboard:ingest stopped`, `process.exit(0)`. ✅
5. **Pidfile at `dashboard/data/ingest.pid`, deleted on shutdown.** `DEFAULT_PID_FILE = resolve(DASHBOARD_ROOT, "data", "ingest.pid")` at `:42`. `acquirePidLock` writes `process.pid` at `:71-72`; `releasePidLock` removes it at `:75-87`. ✅
6. **Live PID → refuse + exit 1 + clear message.** `acquirePidLock` at `:60-68`: reads file, `Number.parseInt`, `isProcessAlive` (uses `process.kill(pid, 0)`, treats `EPERM` as alive — correct per `:53-55`). If alive: prints `dashboard:ingest already running (pid <N>, pidfile <path>); refusing to start a second instance` to stderr, `process.exit(1)`. ✅
7. **Stale pidfile silently overwritten.** Same `acquirePidLock` path — if `isProcessAlive` returns false, falls through to `writeFileSync` overwrite at `:72` without logging. ✅
8. **Idempotency e2e test.** First test in `cli/ingest.test.ts`: spawns CLI via `process.execPath --import tsx <script>` (no shell wrapper — crucial on Windows so `child.pid` is the real Node PID), waits ~1.5 s, sends SIGINT, asserts 5 rows; respawns on same db + same fixture, waits ~1.5 s, sends SIGINT, asserts still 5 rows. Uses `mkdtempSync`-isolated paths via `INGEST_DB_PATH` / `INGEST_EVENTS_DIR` / `INGEST_PID_FILE` env overrides — never touches real `dashboard/data/` or repo `events/`. ✅
9. **Cleanup.** `afterEach` removes the tmp workDir with a settle+retry to handle Windows EBUSY on the just-closed sqlite file. ✅

## Extra checks passed

- **Race-safe `releasePidLock`** (`:75-87`): only unlinks the pidfile if it still holds our PID. Prevents a graceful shutdown from clobbering a freshly-started successor's pidfile.
- **`process.on("exit", …)` last-ditch cleanup** at `:166-168`. Reduces stale-pidfile risk after an unhandled throw.
- **Path resolution** anchored to `import.meta.url`-derived `DASHBOARD_ROOT` (`:38-42`), so the CLI works regardless of `cwd`.
- **`parsePositiveInt`** throws on garbage env values (`:106-113`); env vars never become silent NaNs.
- **Two extra CLI tests** cover live-PID refusal and stale-pidfile overwrite — both pass on this Windows host.
- **Windows SIGINT caveat acknowledged** in the test header: `child.kill("SIGINT")` is abrupt on Windows, but correctness is preserved by per-batch WAL transactions + `INSERT OR IGNORE`. Reviewer flagged this and accepted — verified.

## Merge

```
gh pr merge 5 --squash --delete-branch
gh pr view 5 --json state,mergedAt,mergeCommit
  → {"mergedAt":"2026-05-27T00:32:06Z","sha":"55f29211...","state":"MERGED"}
git fetch origin
git pull --ff-only origin claude/ecstatic-gates-oHkEg → fast-forward to 55f2921
```

## Verdict

Approved by reviewer, re-verified by tester, merged to `claude/ecstatic-gates-oHkEg`. **Layer 1 (event store + ingest worker + CLI) is now complete on trunk.** task-005 (Layer 1 verification) is unblocked.

## Operator-visible side notes (not blocking)

- Local `task/task-004-ingest-cli-script` branch had a user-authored commit on top of the PR tip that was never pushed to origin: `4d16d2f fix(prompts): tester must verify origin trunk shows completion, not just local`. Its commit message claimed it would land via this PR's squash merge — but it wasn't on the PR, so it wouldn't have. Preserved on local branch `local/save-tester-prompt-fix` so it isn't lost. (Same pattern as the earlier `local/save-runner-preview-bump`.)
