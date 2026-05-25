---
id: task-005-verify-layer1
title: Tester verification — Layer 1 end-to-end
assignee: tester
status: unstarted
priority: high
createdAt: 2026-05-26T00:45:00Z
dependsOn: [task-004-ingest-cli-script]
---

## Requirements

End-to-end verify Layer 1 (event store + ingest) against the **live** JSONL stream this team is producing, not just fixture data. Run the ingest against the real `events/` directory, induce real activity from one of the running agents (or fake it by appending a hand-crafted event to `events/test.jsonl`), confirm every Layer 1 acceptance criterion from `design/dashboard.md`. File a `bug-task-005-*` task for any criterion that fails.

This task gates the start of Layer 2 (SSE server). Do not approve Layer 1 if any criterion is unverified.

## Acceptance Criteria

Walk through every Layer 1 acceptance criterion from `design/dashboard.md` and check it on the merged trunk code (post-task-004 merge):

- [ ] `dashboard/data/events.db` is created on first ingest start and contains a schema matching `AgentEvent` (use `sqlite3 dashboard/data/events.db .schema` to confirm).
- [ ] Running `npm run dashboard:ingest` starts in the foreground, prints a periodic stat line, and accepts Ctrl-C cleanly.
- [ ] **Latency check**: with ingest running, manually `echo` a well-formed event JSON line into `events/test.jsonl`. A new row appears in `events.db` within 1 second (verify with `sqlite3 dashboard/data/events.db "SELECT event_id, ts FROM events ORDER BY ts DESC LIMIT 1"`).
- [ ] **Offset resume**: stop ingest, append 2 more events to the same file, restart ingest. The 2 new events appear in the db; the previous events are NOT re-inserted (row count delta = 2, not 2 + prior).
- [ ] **Idempotency**: stop ingest, delete the offset row for one file from `ingest_offsets`, restart. The events from that file are not duplicated (asserted via `SELECT COUNT(*), event_id FROM events GROUP BY event_id HAVING COUNT(*) > 1` returning zero rows).
- [ ] **Real-stream sanity**: with ingest running and at least one agent active in the background, the agent's next tick produces events that appear in the db. Confirm by comparing `jq '.event_id' events/<agent>.jsonl | tail -5` to `sqlite3 ... "SELECT event_id FROM events WHERE agent_id='<agent>' ORDER BY ts DESC LIMIT 5"`.
- [ ] If all pass: post an "approved" verdict on the relevant PRs (already done by reviewer; tester writes a short Layer 1 verification note inline in this task's Notes section) and flip task-005 to `completed`.
- [ ] If any fail: file `tasks/bug-task-005-<short-description>.md` assigned to engineer with `status: unstarted`, `priority: high`, describing the failure and the failing criterion. Leave task-005 in `in_progress` until the bug is fixed and re-verification passes.

## Notes
