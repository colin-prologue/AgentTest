# Active Goals

## goal-001: Implement the Agent Visualization Dashboard

- Status: active
- Created: 2026-05-25
- Owner: PM (decomposes into tasks for the team)

### Summary

Build the visualization system described in `design/dashboard.md`. The dashboard should let a human operator (a) check in at a glance, (b) scan the history, and (c) audit + interrupt when an agent goes off track.

### Constraints

Work the layers **in order**; do not start a layer until the previous one is end-to-end verifiable against the live JSONL stream this team is itself producing.

1. Event store + ingest (`design/dashboard.md` § Layer 1)
2. SSE server (§ Layer 2)
3. Timeline view (§ Layer 3)
4. Board view (§ Layer 4)
5. Audit drawer (§ Layer 5)
6. Interrupt API (§ Layer 6)

### Notes for the PM

- Each layer in the design doc has its own acceptance criteria — translate those into engineer-sized tasks (≤1 hour each, one task per criterion if a criterion is non-trivial).
- Do not let the engineer start Layer N+1 until Layer N's tasks are all `completed` (verified by the tester).
- The dashboard code lives under `dashboard/` in the repo. Treat it as a fresh subdirectory; pick your stack (React+Vite or SvelteKit are both fine).
- The first engineer-sized task should be: "Set up `dashboard/` package skeleton with TypeScript, Vite, and a stub Node server that responds 200 on `/health`." This unblocks everything else.
