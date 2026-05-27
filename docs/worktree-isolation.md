# Per-agent worktree isolation (proposed)

A design sketch — not yet implemented. Captured here so it can be picked up cold in a future session without re-litigating the analysis.

## Problem

All four agents share the same `.git` directory and working tree. When the engineer runs `git checkout task/<id>`, it swaps `HEAD` for every other agent process in the repo — they're all looking at the same files via the same checkout. Symptoms we hit during the first end-to-end cycle:

- **PM blocked itself** mid-cycle because its `git status` showed a task branch with uncommitted engineer WIP — the PM correctly couldn't tell which version of `tasks/` was authoritative.
- **My own commits landed on the wrong branch.** While I was preparing a hook fix on trunk, the engineer's parallel `git checkout` had switched HEAD under me; my commit went to the task branch and stranded. Required a cherry-pick recovery.
- **A tester `git stash push -u`** (last action before the operator killed it) accidentally swept up four PM-decomposed task files as untracked content. They were only recoverable from the stash's still-reachable SHA.

Every recurrence of this class of bug costs ~10-30 minutes of operator triage and risks losing work. It will continue to surface every time the operator restarts, interrupts, or edits anything mid-cycle.

## Constraints

- **Single `.git` directory.** All agents must see each other's commits, branches, refs without manual sync. Git's `worktree add` is designed for exactly this — multiple checkouts sharing one object store.
- **Branch-ref ownership is exclusive.** A given branch can only be checked out in one worktree at a time. Two agents both wanting `trunk` checked out as a local branch ref → conflict. Workaround: detached HEAD pointing at the same SHA.
- **`events/`, `agents-state/`, `control/` must remain shared.** All agents write to the same JSONL streams; session files and pause flags are operator-facing and must live in one canonical place.

## Design

Two-worktree minimum, not four. Only the agents that move HEAD across the cycle need isolation:

```
AgentTest/                              # main worktree — operator + PM + reviewer
  .git/                                 # shared object store
  agents/  goals/  design/  docs/
  tasks/                                # on trunk (PM + reviewer read here)
  events/  agents-state/  control/      # shared, absolute-path resolved
  worktrees/
    engineer/                           # engineer-only checkout
      tasks/ ...                        # whatever branch engineer is on
    tester/                             # tester-only checkout
      tasks/ ...                        # PR branch during verify, trunk during bookkeeping
```

**Why only engineer + tester:**

- **Engineer** is the highest-frequency HEAD-mover. It branches off trunk for every task. Isolating it eliminates ~80% of HEAD races.
- **Tester** is the second-highest. It checks out PR branches for verification, then needs trunk for the bookkeeping commit. Isolating it eliminates the rest of the cross-agent HEAD churn.
- **PM** is read-mostly. Reads `tasks/*.md`, `goals/active.md`, writes `status.md` and new task files. All on trunk. No HEAD movement. Safe to stay in main worktree.
- **Reviewer** is read-only via `gh pr view` and `gh pr diff` (it doesn't check out PR branches locally). Stays in main worktree. The one write it does — `tasks/<id>-review.md` — goes on trunk and needs the same commit+push pattern the tester just got.

The operator's view is the main worktree, same as today. They can still browse `tasks/`, run scripts, look at `status.md` without realizing two of the agents are off in their own checkouts.

## Implementation

**`agents/shared/runner.ts`** — add a worktree-setup step before the query loop. Use `execFileSync` rather than the shell form to avoid string-injection risk in the agent name.

```ts
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ISOLATED_AGENTS = new Set(["engineer", "tester"]);
const TRUNK = "claude/ecstatic-gates-oHkEg";

function ensureWorktree(agentId: string): string {
  const repoRoot = process.cwd();
  if (!ISOLATED_AGENTS.has(agentId)) return repoRoot;
  const wt = path.join(repoRoot, "worktrees", agentId);
  if (!fs.existsSync(wt)) {
    // Detached HEAD at trunk tip — doesn't conflict with main worktree's trunk ref.
    execFileSync("git", ["worktree", "add", "--detach", wt, `origin/${TRUNK}`], { stdio: "inherit" });
  }
  return wt;
}

// In runAgent, before the while(true):
const cwd = ensureWorktree(agent_id);
process.chdir(cwd);
```

**`agents/shared/events.ts` and `agents/shared/hooks.ts`** — already good. Both capture `process.cwd()` at module-load time (before runner's chdir). `EVENTS_DIR`, `BLOBS_DIR`, `CONTROL_DIR` resolve to absolute paths in the main repo and survive the chdir.

**`agents/shared/session.ts`** — verify it captures cwd at module load too. If not, fix to resolve `agents-state/` once at module load.

**Prompt updates:**

- Engineer prompt: change "Refresh trunk: `git checkout <trunk> && git pull`" to "Refresh: `git fetch origin && git checkout --detach origin/<trunk>`" (detached, since trunk branch ref lives in main worktree).
- Tester prompt: same change for its `git checkout <baseRefName> && git pull` step. After merge: `git fetch origin && git checkout --detach origin/<baseRefName>`, then create an ephemeral local branch from there to commit + push the bookkeeping (since pushing from detached HEAD doesn't work directly).
- PM prompt: no change. Stays in main worktree on trunk.
- Reviewer prompt: add the same commit+push step the tester has, for `tasks/<id>-review.md`. Reviewer can do this from the main worktree since it owns trunk's checkout.

**The bookkeeping-push from a detached worktree** is the trickiest piece. Pattern for the tester (and for the engineer's PR-flip step):

```bash
# Inside worktrees/tester/, post-merge:
git checkout -B tester-bk-<task-id> origin/<trunk>   # short-lived local branch off trunk tip
# ...edit task file, write verified.md...
git add tasks/...
git commit -m "chore(<task-id>): mark completed"
git push origin tester-bk-<task-id>:<trunk>          # fast-forward push onto trunk
git checkout --detach origin/<trunk>                  # return to detached
git branch -D tester-bk-<task-id>                     # cleanup
```

The `local:remote` push form works because the local branch was just created from trunk's tip and the new commits are a clean fast-forward. Branch protection (`allow_force_pushes=false`) allows fast-forward pushes.

## Migration

One-time, low risk:

1. From the operator's main worktree, with all agents stopped: `git worktree add --detach worktrees/engineer origin/claude/ecstatic-gates-oHkEg`, same for tester.
2. Add `worktrees/` to `.gitignore`.
3. Ship the runner.ts change + prompt updates as a single PR.
4. Wipe engineer and tester sessions (their old memories assume the main worktree).
5. Restart. First engineer/tester tick runs in their respective worktrees — verifiable via the events log's `pre_tool_use` payloads (`tool_input.command` runs with the worktree as cwd).

## Open questions

- **What if a task branch is already checked out in the main worktree at migration time?** `git worktree add` refuses to share a branch ref. Mitigation: only migrate when the team is between tasks (status.md shows no `in_progress`), or detach-checkout the main worktree first.
- **Should reviewer ALSO get its own worktree?** Today reviewer reads via `gh`, but if it ever needs to run a local build/lint against a PR diff, it'll need a checkout. Future call.
- **Trunk-write contention** between PM tick and reviewer tick (both want to write to trunk in main worktree). Cheap mitigation: a single advisory file lock in `control/git-lock` only the main-worktree agents respect.
- **Worktree behavior on Windows.** Git worktrees have been less polished on Windows historically. Smoke-test `git worktree add` + concurrent `git fetch` from two worktrees for 1 layer (~30 min) and read the events log for git errors before declaring stable.

## Rollback

If the worktree refactor breaks something:

1. Stop all agents.
2. From main worktree: `git worktree remove worktrees/engineer && git worktree remove worktrees/tester`.
3. Revert the runner.ts + prompts.ts commit.
4. Restart. Agents are back in the main worktree, exactly as before.

No data-loss path — sessions and events remain in shared `agents-state/` and `events/`.
