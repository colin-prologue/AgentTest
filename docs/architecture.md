# Architecture

The mental model for the multi-agent harness. Read this before making structural changes.

## The agent loop

Every agent is a Node process running:

```
while (true) {
  if (paused) sleep; continue
  query({ prompt: firstTick ? rolePrompt : tickPrompt,
          options: { resume: sessionId, hooks, ... } })  // SDK runs the
                                                         // perceive→act→verify loop
  saveSessionId()                                        // memory for next tick
  sleep(pollInterval)
}
```

The SDK handles the inner perceive → act → verify loop within a single `query()` call. We handle the outer pacing loop. Session resume preserves the agent's accumulated context across ticks — so an Engineer that started a task on tick N can resume mid-implementation on tick N+1 with full memory.

First tick of any session sends the full role prompt; subsequent ticks (after `resume`) send only the short "tick" prompt — the role is already in conversation history. This keeps tokens-per-tick low.

## The four agents

| Agent | Cadence | Owns | Reads |
|---|---|---|---|
| **PM** | 60s | `goals/`, `tasks/*.md` (creation), `status.md` | `goals/`, `tasks/`, `design/` |
| **Engineer** | 30s | `task/<id>` branches, `dashboard/`, task files (status flips) | `tasks/`, `design/`, code |
| **Reviewer** | 45s | `tasks/<id>-review.md`, task status (approved/changes_requested) | task files, git diffs |
| **Tester** | 90s | `tasks/<id>-verified.md`, `tasks/bug-<id>.md`, task status (completed) | main branch, test output |

Cadences are staggered so the agents don't all hit the API at the same instant.

## Coordination: filesystem-as-blackboard

We chose **filesystem coordination** over MCP/Redis/DB for the bootstrap because:
- Zero external dependencies — `git clone` and `npm install` is all the setup
- The task board is human-readable (`cat tasks/task-001.md`) and human-editable for steering
- Git is the persistence layer and the audit trail
- Atomic enough at this scale (one writer per task at a time, by convention)

The exchange surfaces:
- `goals/active.md` → PM input
- `tasks/<id>.md` → multi-agent contract (assignee + status fields are the protocol)
- `status.md` → PM's snapshot for human eyeballs
- `events/*.jsonl` → observation stream (one-way, append-only)
- `control/pause-<agent>` → human steering channel

When the team scales beyond one machine, the right swap is a small MCP server fronting SQLite (or a real DB). The agent prompts won't need to change — only the tool surface.

## Memory: session resume

`agents-state/<agent>.session` holds the SDK session id per agent. On each tick we pass `resume: sessionId` so the agent re-enters its accumulated context. Clearing that file is the "amnesia button" — useful when an agent's session has been poisoned by hallucinated context (see `playbook.md`).

This is materially different from spawning a fresh agent every tick — a resumed Engineer remembers what it was working on, what tests it ran, what didn't work last time. The tick prompt is just a wake-up; the substance is in the history.

## Observation + safety: hooks

`agents/shared/hooks.ts` builds a hook bundle wired into every `query()` call:

- `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop` → append structured events to `events/<agent>.jsonl`. Large payloads spill to `events/blobs/<sha>.txt` and are referenced by `blob_ref`.
- `PreToolUse` on `Bash` runs a denylist (`rm -rf /`, `sudo`, push to main, force-push, curl-to-shell, fork bombs). Matches → `permissionDecision: "deny"` + a `decision` event recording the block.

Agents run with `permissionMode: "bypassPermissions"` because they must work unattended. The denylist is the only thing standing between the agent and the host — keep it tight.

## Why we didn't just use Claude Code's agent teams

Claude Code has an experimental "agent teams" feature (parallel coordinated sessions in one terminal, file-lock task claiming, direct inter-agent messaging). It's great for **one-shot parallel investigation with a human steering in real time** — code review with security/perf/coverage angles, hypothesis-racing during debugging.

It's the wrong tool for **long-running autonomous goal pursuit**:
- Teams are one-shot; we need agents that resume tomorrow with full memory
- Teams coordinate within a single session; we need persistent state across many sessions
- Teams optimize for live steering; we optimize for unattended operation with an audit trail

A team-style burst is a tactic one of our agents could *use* (e.g., Engineer spinning up a team to investigate four refactor approaches in parallel). It's not a replacement for the harness.

## Where to make changes

| If you want to… | Edit |
|---|---|
| Change what an agent does | `agents/shared/prompts.ts` (role + tick) |
| Add a safety rule, new event type, or new tool capture | `agents/shared/hooks.ts` |
| Add a new role | new entry point in `agents/`, prompts in `prompts.ts`, register in `scripts/supervise.ts` |
| Change pacing or permission posture | `agents/<role>.ts` (poll_interval_ms, permissionMode) |
| Change the event schema | `agents/shared/events.ts` — but coordinate with the dashboard layer |
| Change loop structure (don't, lightly) | `agents/shared/runner.ts` |

The runner is intentionally minimal. Push complexity into prompts and hooks, not the loop.

## What's deferred (not in this architecture yet)

- **Stop-hook re-planner** — a Stop hook that decides "more work? continue same session : let outer loop sleep". Cheaper than restart, preserves context tightly. Worth adding once we've watched the team enough to know when it'd pay off.
- **Token budget circuit-breaker** — PostToolUse hook aborting a session if cumulative tokens exceed a threshold for the current task. Defensive against a thrashing Engineer.
- **GitHub MCP integration** — Engineer prompts assume PRs may be created via MCP or file stubs. Wiring real MCP is a deliberate next step (see `roadmap.md`).
- **Parent event IDs / causality chains** — the schema has a `parent_event_id` slot but the hooks don't populate it yet. The dashboard's ingest layer can infer most causality from `session_id` + ordering; explicit population is a later sharpening.
