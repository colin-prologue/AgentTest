---
id: task-001-dashboard-skeleton
title: Set up dashboard/ package skeleton (TypeScript + Vite + stub Node server with /health)
assignee: engineer
status: review_pending
priority: high
createdAt: 2026-05-25T00:00:00Z
startedAt: 2026-05-25T15:50:00Z
handoffAt: 2026-05-25T16:00:00Z
pr: https://github.com/colin-prologue/AgentTest/pull/1
dependsOn: []
---

## Requirements

Create the `dashboard/` subdirectory as a self-contained package that everything else in the dashboard layers will build on. It must have:

- Its own `package.json` (workspace-friendly; sibling to the root `package.json`).
- TypeScript configured (`tsconfig.json` in `dashboard/`).
- Vite configured for the frontend SPA (even though the SPA itself is not built yet — just the build tooling).
- A minimal Node server (`dashboard/src/server/index.ts`) that listens on a port (default 7777, env-configurable via `PORT`) and responds `200 OK` with body `{"ok":true}` to `GET /health`.
- A root-level npm script `dashboard:dev` that starts the stub server in the foreground (use `tsx`).

Pick the stack to match the design doc constraints: React + Vite is fine (SvelteKit also acceptable). Document the choice in a short `dashboard/README.md` (one paragraph).

Do **not** wire SQLite, ingest, or any other layer here — this task is just the skeleton.

## Acceptance Criteria

- [ ] `dashboard/package.json` exists with `type: "module"` and `tsx` + `vite` + (chosen UI framework) as dev deps.
- [ ] `dashboard/tsconfig.json` exists and `npx tsc --noEmit -p dashboard` passes with zero errors.
- [ ] `dashboard/src/server/index.ts` starts a server on port 7777 (env `PORT` override works).
- [ ] `curl http://localhost:7777/health` returns HTTP 200 and JSON body `{"ok":true}`.
- [ ] Root `package.json` has a `dashboard:dev` script that runs the stub server in the foreground via `tsx`.
- [ ] Engineer opens a PR; CI (if any) is green; PR description names the chosen frontend framework.

## Notes
