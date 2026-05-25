# Roadmap

The forward arc for the harness and the team. Phase 1 is the current initiative; later phases capture deferred work and open questions so a new session can pick up without re-litigating decisions.

## Phase 0 — Bootstrap (done)

- ✅ Four-agent harness with filesystem coordination
- ✅ Shared hook bundle: structured event capture + Bash safety denylist
- ✅ Session resume per agent
- ✅ PM prompt sharpened after hallucination incident (see `playbook.md` once written)
- ✅ Live tail viewer (`scripts/tail-pretty.sh`)

## Phase 1 — Visualization dashboard (current)

The team is building the dashboard described in `design/dashboard.md`. Six layers, strict ordering, each must be tester-verified before the next:

1. Event store + SQLite ingest of `events/*.jsonl`
2. SSE server
3. Timeline view (per-agent swimlanes)
4. Board view (task DAG with live status)
5. Audit drawer (event detail + causality)
6. Interrupt API (pause / note / rewind / kill)

**Success criteria for phase exit:** human operator can run the dashboard locally, watch the team work in real time, drill into any event, and pause/inject-note/rewind agents without touching the filesystem directly.

**The meta-property:** the dashboard's first production data is its own construction. Once Layer 3 ships, we switch from `npm run tail:pretty` to watching the team's work in the dashboard they're building. That's the moment the system becomes self-observing.

## Phase 2 — Production integration

Things we deliberately did not wire into the bootstrap so we could see the loop work first:

- **GitHub MCP server** for real PR creation, review, and merge. Today the Engineer can write `tasks/<id>-pr.md` stubs; with MCP it'd open real PRs and the Reviewer would post real review comments. The agents' prompts already anticipate this — just need to wire the MCP server into `agents/{engineer,reviewer}.ts` mcpServers config.
- **Token budget circuit-breaker hook** — PostToolUse aborts a session if it burns past N tokens on a single task without progress (no Edit/Write events in the last K turns).
- **Stop-hook re-planner** for tight follow-on work (continue same session if next task is already queued, instead of sleep + restart).
- **Test framework conventions** — the Tester runs `npm test` today, but real projects need test discovery, retry on flakes, and structured pass/fail reporting back to task files.

## Phase 3 — Scaling

When the single-machine, single-team model strains:

- **MCP-backed task board** — swap filesystem `tasks/*.md` for a small MCP server fronting SQLite. Lets agents on different hosts share state; gives concurrent task claiming proper transactions.
- **Multi-host event ingest** — current ingest tails local JSONL; for distributed agents, switch to NATS-JetStream or Redis streams as the transport.
- **Per-task isolation** — Engineer-per-task workers (spawned by a supervisor) instead of one long-lived Engineer. Trades memory continuity for parallelism.
- **Authentication / multi-user dashboard** — currently local-only.

## Phase 4 — Other initiatives

Once the harness is proven on the dashboard build, candidate next initiatives for the team to tackle:

- A real product feature in a real repo (the harness would clone the target repo as a sibling and the agents work on it)
- A continuous bug-triage agent role (reads issue tracker, classifies, files reproductions)
- A documentation-maintenance agent role (watches diffs, suggests doc updates as PRs)

These are speculative — depends on how Phase 1 feels in practice.

## Open architectural questions

Captured here so a new session doesn't re-litigate them:

- **When to add the Reviewer and Tester?** Bootstrap recommendation was PM+Engineer first, then Reviewer, then Tester. We're still in the early observation phase — if the PM+Engineer pair is producing clean work, layer Reviewer in next. Don't bring Tester up until there's something worth verifying on `main`.
- **Pre-seed first task or trust the PM?** We pre-seeded `task-001-dashboard-skeleton.md` to unblock the Engineer immediately. After the PM prompt was sharpened, the PM has been able to decompose Layer 1 on its own. Going forward: trust the PM unless it visibly stalls.
- **GitHub MCP yes/no for Phase 1?** Deferred. File-based PR stubs are fine for the dashboard build (no external review needed yet). Wire MCP when we move to Phase 2 or to a real downstream initiative.
- **Smoke-test goal before real initiatives?** We skipped a smoke test and went straight to the dashboard. So far so good. If a future initiative looks risky, a one-task smoke-test goal first is a cheap insurance policy.
- **Token budgets and abort thresholds?** Not yet implemented. Plan: a PostToolUse hook that tracks turns-without-Write per session and aborts after K. Open question is what K should be — depends on observed thrashing behavior.
- **How aggressive should the Reviewer be?** Approve-on-criteria-met vs request-changes-on-anything-imperfect. Current prompt is "approve if criteria are met even if you'd have done it differently" — watch in practice and tune.

## Decisions made (don't relitigate without reason)

- Filesystem coordination over MCP for the bootstrap. Reason: zero deps, human-readable, git as audit trail.
- Separate processes per agent, not one orchestrator with subagents. Reason: persistent autonomy across sessions, isolated context, clear failure boundaries.
- `bypassPermissions` + Bash denylist hook over `acceptEdits` + prompts. Reason: `acceptEdits` still prompts on network Bash (git push), which kills unattended operation.
- Session resume on every tick rather than fresh sessions. Reason: memory continuity is the whole point of long-running agents.
- Layer-strict ordering for the dashboard build. Reason: each layer must work end-to-end against live data before the next starts; otherwise we're building UI against an empty store.
- No GitHub MCP in Phase 1. Reason: dashboard build doesn't need external review; deferring kept the bootstrap small.
- One CLAUDE.md at repo root, no nested ones. Reason: agents read `design/dashboard.md` for their work, not `CLAUDE.md`. CLAUDE.md is for Claude Code sessions, not the team.
