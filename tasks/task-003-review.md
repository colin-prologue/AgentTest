# Review — task-003-tail-ingest-worker

Reviewed `task/task-003-tail-ingest-worker` (PR #4). Diff: 3 files (`dashboard/src/server/ingest.ts`, `ingest.test.ts`, task file).

## Acceptance criteria

### `dashboard/src/server/ingest.ts` exports `startIngest({ db, eventsDir, pollMs? }): { stop(): Promise<void> }`
**Pass.** Exported with that exact shape (`StartIngestOpts` / `IngestHandle`). Adds a `tickNow()` escape hatch on the handle for tests — documented as such; harmless.

### On start, scans `events/*.jsonl`, reads saved offset, resumes (offset 0 if new)
**Pass.** `processFile` looks up `ingest_offsets` via `SELECT offset FROM ingest_offsets WHERE file = ?` and falls back to `0`. Uses `resolve(filePath)` as the key so a relative `eventsDir` and an absolute one map to the same row — good.

### Atomic batch: event inserts + offset upsert in a single SQLite transaction per file per tick
**Pass.** `db.transaction(() => { for (event of events) insertEvent(...); UPSERT offset })` exactly as specified. With WAL mode (set in `db.ts`) this is durable across crashes; combined with `INSERT OR IGNORE` it's also idempotent on replay.

### Polling default 500 ms; new events in SQLite within 1 s of append
**Pass.** `DEFAULT_POLL_MS = 500`. The first tick runs immediately at startup (not after one pollMs) — nice. Test asserts a 100 ms-poll worker has 3 events visible after 800 ms.

### Malformed JSON: log + advance, don't crash, don't retry
**Pass.** `parseLines` `try/catch JSON.parse`, logs `console.error` with the file path, skips, and the bad line is `pop`'d off so the offset advances past it. The "skips malformed JSON" test confirms parse-error stays at 2 events across two ticks and the offset stays put after EOF.

### Discovers new `events/*.jsonl` files after start
**Pass.** `listJsonlFiles` runs every tick (it's a fresh `readdirSync`). The "discovers files that appear after start" test writes a new file mid-run and asserts ingestion.

### `stop()` flushes in-flight transactions and resolves cleanly
**Pass.** `stop()` sets `stopped=true`, clears the pending `setTimeout`, and `await`s `inFlight`. Because `better-sqlite3` is synchronous, the transaction is already complete by the time `inFlight` resolves. The "stop() is safe to call before any tick completes" test exercises the early-stop path.

### Vitest integration test: 3 events → run ~1.5s → 3 rows; +2 → 5 rows; stop+restart → no re-read
**Pass.** The first test does exactly that, plus captures the offset across restart and asserts the offset row carried over (a stronger guarantee than just row count, since `INSERT OR IGNORE` would have masked a re-read).

### Test cleans up `events/test-ingest.jsonl`
**Pass.** `afterEach` removes the fixture file and the entire tmp workDir. The test uses a `mkdtempSync` isolated dir rather than the repo's real `events/`; the test file's header explicitly justifies this (to avoid colliding with a running agent process), which is the right call — the spirit of the AC is met without risking the real event stream.

## Extra checks
- **Partial-line handling.** `parseLines` `pop()`s the trailing chunk after the final `\n`; the offset is rewound by `Buffer.byteLength(partial)` so the partial line is re-read next tick once its newline arrives. The "partial trailing line" test covers this, and it's the single most failure-prone thing in a tailer — good to see explicit coverage.
- **Truncation recovery.** If a file shrinks below the stored offset, `readNewBytes` returns `{content: "", endOfFile: size}` and the transaction upserts the offset down to the new size — next tick reads from there. Sensible.
- **Disappearing files.** `readNewBytes` catches the `statSync` error and returns `undefined`, which short-circuits `processFile`. The offset row is left intact in case the file reappears. Matches the file header's documented behavior.
- **Tick errors are isolated.** `tick()` wraps each file in `try/catch`, and `loop()` wraps `tick()` again. One bad file won't poison the others or stall the poller.
- **No secrets, no auth, no untrusted-input surface.** All filesystem paths come from the caller; SQL is parameterized.
- **Test suite.** `npm test` runs 10 tests (5 db + 5 ingest), all green. `npm run typecheck` clean.

## Verdict

Approved. Meets every acceptance criterion, plus thoughtful coverage of partial-line/truncation/disappearance edges that the AC didn't explicitly demand.
