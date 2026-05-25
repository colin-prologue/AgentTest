# Agent Team Bootstrap

A minimal harness for running four autonomous agents — **PM, Engineer, Reviewer, Tester** — that coordinate via a filesystem task board and emit structured event streams so you can observe their work.

The first initiative the team is set up to tackle (`goals/active.md`) is **building their own visualization dashboard** (`design/dashboard.md`). The meta-test: can the team build the tool you'd use to watch them?

---

## Architecture in one paragraph

Each agent is a Node process running an infinite loop. Every loop iteration calls `query()` from `@anthropic-ai/claude-agent-sdk` with `resume: <session_id>`, so the agent has full memory across ticks. Coordination is via the filesystem (`goals/`, `tasks/`, `status.md`). Observation is via a shared hook bundle that emits structured JSONL to `events/<agent>.jsonl` on every tool call, session start/stop, and decision. The hook bundle also blocks obviously-dangerous shell commands as a safety net.

---

## Prerequisites

- **Node.js 20+**
- **Authentication for the Claude Agent SDK**, one of:
  - `export ANTHROPIC_API_KEY=...` (direct API), or
  - A logged-in `claude` CLI (the SDK falls back to your Claude subscription)
- **Git** with push access to whatever remote you want the engineer to push to
- **`jq`** for the pretty tail viewer (optional but recommended)

---

## First-time setup

```bash
npm install
```

Verify auth works by running a single agent for ten seconds — Ctrl-C once you see a `tick_start` event:

```bash
npm run agent:pm
```

If you see auth errors, set `ANTHROPIC_API_KEY` or `claude login` first.

---

## Running the team

### Option A — one terminal per agent (recommended for the first runs)

```bash
# Terminal 1
npm run agent:pm

# Terminal 2
npm run agent:engineer

# Terminal 3
npm run agent:reviewer

# Terminal 4
npm run agent:tester

# Terminal 5 — live event viewer
npm run tail:pretty
```

This is the clearest setup for monitoring — you see each agent's stdout in its own window, plus the unified event stream in a fifth window.

In **iTerm2** (macOS): ⌘D to split right, ⌘⇧D to split down. Lay out 4 quadrants + 1 wide tail at the bottom.
In **tmux**: `tmux new -s agents`, then `Ctrl-b "` for horizontal splits, `Ctrl-b %` for vertical.

### Option B — single supervisor process

```bash
npm run supervise
```

Spawns all four under one parent process, auto-restarts on crash. Output interleaves — pair with `npm run tail:pretty` in another terminal for clarity.

---

## What you'll see

Within a minute of starting the PM:
- `goals/active.md` is read
- `tasks/task-001-*.md`, `task-002-*.md`, ... appear with frontmatter
- `status.md` summarizes the plan

Within a few minutes of the Engineer being up:
- A `task/<id>` branch is created
- Code is committed
- Either a PR opens (if GitHub MCP is configured) or `tasks/<id>-pr.md` is written

Then Reviewer reviews, Tester verifies after merge, PM updates the plan. Loop.

---

## Observing & controlling

| What | Where |
|---|---|
| Live event stream | `npm run tail:pretty` (or `events/*.jsonl` raw) |
| Task board | `ls tasks/`, `cat tasks/<id>.md` |
| PM's summary | `status.md` (when it exists) |
| Per-agent session ids | `agents-state/<agent>.session` |
| Full tool I/O for any event | `events/blobs/<blob_ref>.txt` |

### Pause an agent (between ticks)

```bash
touch control/pause-engineer    # engineer will idle on next tick
rm control/pause-engineer       # resume
```

### Inject a steering note for a task

Add a `## Notes` section to `tasks/<id>.md`. The assigned agent reads the file every tick.

### Reset an agent's memory

```bash
rm agents-state/engineer.session
```

The next tick starts a fresh session with the full role prompt.

### Hard kill

Ctrl-C in the agent's terminal, or `pkill -f "tsx agents/engineer.ts"`.

---

## Pivoting from a Claude Code on-the-web session to your local desktop

This repo was built in a cloud Claude Code session. To run it locally:

```bash
git clone <your-fork-or-the-repo>
cd <repo>
git checkout claude/ecstatic-gates-oHkEg
npm install
export ANTHROPIC_API_KEY=...    # or: claude login
```

Then follow **Option A** above — open five terminals and run the per-agent commands.

---

## Safety

- All agents run with `permissionMode: "bypassPermissions"` so they can work unattended. The safety net is the `PreToolUse` hook in `agents/shared/hooks.ts`, which denies obviously-dangerous Bash patterns (rm -rf /, sudo, force-push to main, etc.).
- The engineer is prompted to never push to `main` or `master` — and the safety hook backs that up.
- All agent activity is logged. If something goes wrong, `events/*.jsonl` and `events/blobs/` are the audit trail.
- Until the dashboard's interrupt API is built (Layer 6 of the active goal), your kill switches are: the pause file, Ctrl-C, and `git reset --hard origin/main` on any task branch the engineer makes a mess of.

---

## Recommended first-run discipline

1. **Bring up PM and Engineer first.** Skip Reviewer and Tester for the first 1–2 task cycles. Watch the JSONL. Iterate on the prompts if the handoffs feel off.
2. **Watch the first task closely.** A vague PM task → vague engineer work. If the PM writes a task with squishy acceptance criteria, kill it and refine the PM prompt or write the first task by hand.
3. **Let it fail once.** The point of the harness is to observe how the team recovers from a stuck task. Don't rescue too early.
4. **Then turn loose.** Add Reviewer and Tester, set the dashboard goal, and step back.

---

## File map

```
agents/
  shared/
    events.ts      # AgentEvent type + JSONL writer + blob store
    hooks.ts       # Hook bundle (logging + safety denylist)
    prompts.ts     # Role + tick prompts for each agent
    runner.ts     # The query() loop with session resume
    session.ts     # session_id persistence
  pm.ts            # PM entry point
  engineer.ts      # Engineer entry point
  reviewer.ts      # Reviewer entry point
  tester.ts        # Tester entry point

scripts/
  supervise.ts     # Spawn all four agents under one parent
  tail.sh          # Compact one-line JSONL view
  tail-pretty.sh   # Color-coded view (needs jq)

design/
  dashboard.md     # The architectural spec the agents are building from

goals/
  active.md        # Seed goal (the dashboard initiative)

tasks/             # PM writes here; engineer/reviewer/tester read/update
events/            # JSONL streams + blob storage (gitignored at runtime)
agents-state/      # Session ids per agent (gitignored)
control/           # Pause flags (gitignored)
```
