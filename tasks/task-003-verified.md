# Tester verification — task-003-tail-ingest-worker

**PR:** #4
**Head branch verified at commit:** `b9d59ba` (`feat(dashboard): tail-ingest worker with offset resume (task-003)`)
**Base branch:** `claude/ecstatic-gates-oHkEg` (team trunk — not real `main`/`master`, safety check passed)
**Squash-merge commit on trunk:** `90f800ea6a06966aa97644c681bf30768a2c3780`
**Merged at:** 2026-05-27T00:19:39Z

## Pre-merge commands run

```
git fetch origin
git checkout task/task-003-tail-ingest-worker      # was at origin tip b9d59ba
npm install --prefix dashboard                      # 0 added, deps already cached
npm test                                            # delegates to npm test --prefix dashboard
npm run typecheck --prefix dashboard                # tsc -b, clean
```

## Test results

`npm test` (root → `npm test --prefix dashboard` → `vitest run`):

```
 ✓ src/server/db.test.ts (5 tests) 8ms
 ✓ src/server/ingest.test.ts (5 tests) 4596ms
   ✓ ingests existing lines, picks up appends, and survives restart without re-reading  2154ms
   ✓ skips malformed JSON lines without crashing or stalling                            829ms
   ✓ discovers files that appear after start                                            750ms
   ✓ handles a partial trailing line: leaves it un-ingested until newline arrives       842ms
   ✓ stop() is safe to call before any tick completes

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Duration  4.92s
```

The "malformed JSON" test logs `ingest: malformed JSON in <fixture> (skipping): ...` to stderr — this is the AC-mandated log path, not a failure.

`npm run typecheck --prefix dashboard`: exit 0, no output (clean).

## Acceptance criteria — verified against PR branch code (`dashboard/src/server/ingest.ts`)

1. **`startIngest({ db, eventsDir, pollMs? }): { stop(): Promise<void> }`.** Exported at `ingest.ts:138`; `StartIngestOpts` at `:26`, `IngestHandle` at `:34`. Adds a `tickNow()` escape hatch for tests (documented in the JSDoc; harmless). ✅
2. **Scans `events/*.jsonl`, reads offset, resumes from saved offset (0 if new).** `processFile` at `:97-102`: `SELECT offset FROM ingest_offsets WHERE file = ?`, falls back to `0`. Uses `resolve(filePath)` as the key so relative/absolute `eventsDir` map to the same row. ✅
3. **Atomic batch: inserts + offset upsert in one SQLite transaction per file per tick.** `:114-120`: `db.transaction(() => { for events: insertEvent; UPSERT offset })`. ✅
4. **Polling default 500 ms; events visible within 1 s.** `DEFAULT_POLL_MS = 500` at `:41`; first tick runs immediately on start (`loop()` invoked at `:181` before `scheduleNext`). Test passes a 100 ms poll and asserts visibility after 800 ms. ✅
5. **Malformed JSON: log + skip + advance.** `parseLines` at `:73-95`: `try { JSON.parse }`, on catch `console.error` with file path, skips. The `partial` rewind at `:77-79` only rewinds for the trailing incomplete line, so bad complete lines stay past the offset and aren't retried. Test "skips malformed JSON" confirms event count stays at 2 across two ticks. ✅
6. **Discovers new files after start.** `listJsonlFiles` at `:123-136` runs every tick (fresh `readdirSync`); called from `tick()` at `:148`. Test writes a file mid-run and asserts ingestion. ✅
7. **`stop()` flushes and resolves cleanly.** `:184-191`: sets `stopped`, clears `currentTimer`, `await inFlight`. Since `better-sqlite3` is sync, in-flight tx is already durable when `inFlight` resolves. Test "stop() before any tick completes" exercises the early-stop path. ✅
8. **Integration test: 3 → 5 → restart without re-read.** First test in `ingest.test.ts` writes 3 events, runs ~800 ms, asserts 3 rows, appends 2 more, asserts 5 rows, stops, recreates worker, asserts no re-read AND that the offset row carried over (stronger than just count, since `INSERT OR IGNORE` would otherwise mask a re-read). ✅
9. **Test cleans up fixture.** `afterEach` removes the fixture file and the `mkdtempSync` workDir. Uses isolated tmp dir rather than the real `events/` — explicit comment justifies this to avoid colliding with a running agent. ✅

## Edge-case coverage verified

- **Partial trailing line.** `parseLines` `pop()`s the chunk after the last `\n` and rewinds offset by `Buffer.byteLength(partial, "utf8")`, so a partial line waits for its newline next tick. Tested.
- **File truncation.** `readNewBytes` at `:60` returns `{content: "", endOfFile: size}` when size shrinks below offset; the tx upserts the offset down to the new size.
- **Disappearing file.** `readNewBytes` catches `statSync` errors and returns `undefined`, short-circuiting `processFile`. The offset row is preserved for if the file returns.
- **Per-file error isolation.** `tick()` wraps each file in `try/catch` at `:149-153`; `loop()` wraps `tick()` again at `:165-168`. One bad file doesn't stall others.

## Merge

```
gh pr merge 4 --squash --delete-branch
gh pr view 4 --json state,mergedAt,mergeCommit
  → {"mergedAt":"2026-05-27T00:19:39Z","sha":"90f800ea...","state":"MERGED"}
git fetch origin
git checkout claude/ecstatic-gates-oHkEg
git pull --ff-only origin claude/ecstatic-gates-oHkEg  → fast-forward to 90f800e
```

## Verdict

Approved by reviewer, re-verified by tester, merged to `claude/ecstatic-gates-oHkEg`. Layer 1's ingest worker is now on trunk. task-004 (ingest CLI wrapper) and task-005 (Layer 1 verification) can proceed.

## Operator-visible side notes (not blocking)

- Found a user-authored local commit on the task-003 branch that was never on the PR: `a7cef72 fix(runner): bump result_preview truncation limits` (touches `agents/shared/runner.ts`, unrelated to task-003). Preserved on local branch `local/save-runner-preview-bump` before the `--delete-branch` merge would have lost it.
