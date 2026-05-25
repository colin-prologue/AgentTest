# CLAUDE.md

Project context for any Claude Code session working in this repo. Keep it concise — this is loaded into every session's context.

## What this is

A bootstrap harness for an autonomous engineering team of four agents (PM, Engineer, Reviewer, Tester) coordinating via a filesystem task board. Each agent is a Node process running `@anthropic-ai/claude-agent-sdk` in a `while(true)` loop with `resume: sessionId` so it has memory across ticks. See `README.md` for the operator guide.

## What the team is currently building

The active initiative (`goals/active.md`) is the **multi-agent visualization dashboard** spec'd in `design/dashboard.md`. Six layers, each must be tester-verified before the next starts:

1. Event store + ingest (SQLite reading from `events/*.jsonl`)
2. SSE server
3. Timeline view (per-agent swimlanes)
4. Board view (task DAG)
5. Audit drawer
6. Interrupt API

The dashboard code will live under `dashboard/` (does not exist yet — the team is building it).

## Repository layout

- `agents/` — runner, shared hooks/events/prompts/session modules, four entry points (`pm.ts`, `engineer.ts`, `reviewer.ts`, `tester.ts`)
- `scripts/` — supervisor and JSONL tail viewers
- `goals/active.md` — high-level initiatives the PM decomposes
- `design/` — architectural specs the PM and engineer reference
- `tasks/` — live task board (YAML frontmatter + markdown body, one file per task)
- `events/` — JSONL event streams per agent; `events/blobs/` holds large tool I/O
- `agents-state/` — session ids per agent (SDK resume); gitignored
- `control/` — pause flags (`touch control/pause-<agent>` halts an agent between ticks); gitignored

## Task file conventions

```yaml
---
id: task-NNN-slug
title: ...
assignee: engineer | reviewer | tester
status: unstarted | in_progress | review_pending | changes_requested | approved | completed | completed_with_bugs | blocked
priority: high | medium | low
createdAt: <ISO timestamp>
dependsOn: [task-id, ...]
pr: <link or file path>          # optional, populated by engineer
---

## Requirements
## Acceptance Criteria
- [ ] testable item
## Notes
```

## Event schema

`AgentEvent` type lives in `agents/shared/events.ts`. Every tool call goes through `PreToolUse` and `PostToolUse` hooks in `agents/shared/hooks.ts` and is appended to `events/<agent>.jsonl`. Payloads over 4KB are written to `events/blobs/<sha256-prefix>.txt` and referenced by `blob_ref`.

## Operating rules

- Agents run with `permissionMode: "bypassPermissions"`. Safety net is the Bash denylist in `agents/shared/hooks.ts` (rm -rf /, sudo, push to main, force-push, curl-to-shell, fork bombs).
- The engineer **never** pushes to `main` or `master`. Work lives on `task/<task-id>` branches.
- Session resume is the memory mechanism. Clearing `agents-state/<agent>.session` gives that agent a fresh start.
- Poll intervals are staggered (PM 60s, Engineer 30s, Reviewer 45s, Tester 90s).

## Gotchas observed during bootstrap

- **PM can hallucinate work.** Result message claims tasks were created without any `Write` tool call. Mitigation: PM prompt requires Glob-after-Write verification and forbids claiming any state not just-read from the filesystem this tick. If you see a recurrence, check `jq -c 'select(.type=="post_tool_use") | {tool: .payload.tool_name}' events/pm.jsonl | sort -u` — should include `Write` on planning ticks.
- **Cross-agent fabrication.** PM occasionally claimed things about engineer state ("engineer picked up task X") it had no way to verify. Same prompt rule blocks this.
- If engineer claims success but expected files don't appear, suspect the same hallucination pattern and tighten the engineer prompt the same way the PM prompt was tightened (see `agents/shared/prompts.ts`).

## When working on this repo as Claude

- **Don't modify `tasks/*.md` manually** unless asked — that's the agents' coordination surface; tampering breaks the loop.
- **Don't push to `main`.** Active development is on `claude/ecstatic-gates-oHkEg` and `task/<id>` branches.
- Respect the layer ordering in `design/dashboard.md` — don't start Layer N+1 work until Layer N is tester-verified.
- First move when debugging an agent is always `jq` over `events/<agent>.jsonl` to see what tools it actually called, not what its result message claimed.
- Prompt changes go in `agents/shared/prompts.ts`. Hook changes in `agents/shared/hooks.ts`. The runner in `agents/shared/runner.ts` is intentionally minimal — push complexity into prompts and hooks, not the loop.

## Branch

Active branch: `claude/ecstatic-gates-oHkEg`. All commits and pushes go here.
