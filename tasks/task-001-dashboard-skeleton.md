---
id: task-001-dashboard-skeleton
title: Dashboard package skeleton + /health endpoint
assignee: engineer
status: in_progress
priority: high
createdAt: 2026-05-26T00:45:00Z
startedAt: 2026-05-25T18:35:00Z
dependsOn: []
---

## Requirements

Create the `dashboard/` subdirectory as a TypeScript Node package with its own `package.json`, a Vite-based frontend stub, and a Node HTTP server that responds 200 on `GET /health`. This task is foundation only — no database, no ingest, no real frontend yet. It exists to unblock every Layer 1 task that follows.

Stack: **React + Vite** for the frontend (per design/dashboard.md), TypeScript everywhere, single `package.json` under `dashboard/`. Node ≥20.

## Acceptance Criteria

- [ ] `dashboard/package.json` exists with `name: "dashboard"`, TypeScript devDep, Vite devDep, `"type": "module"`.
- [ ] `dashboard/tsconfig.json` extends a sane base (strict mode on, `moduleResolution: "bundler"` for the frontend, `"NodeNext"` for the server — split configs are fine).
- [ ] `dashboard/src/server/index.ts` boots an HTTP server on port 7777 (overridable via `PORT` env var) and responds `200 OK` with body `{"status":"ok"}` on `GET /health`.
- [ ] `dashboard/src/frontend/` contains a minimal Vite React app (`main.tsx`, `App.tsx`, `index.html`) that renders the literal text "Dashboard" in an `<h1>`. Does not need to be wired to the server yet.
- [ ] Root `package.json` adds an `npm run dashboard:dev` script (or equivalent under `dashboard/`) that starts the server.
- [ ] `curl -s http://localhost:7777/health` returns `{"status":"ok"}` when the server is running.
- [ ] `dashboard/README.md` (one paragraph) explains how to run the server and the frontend dev server.
- [ ] PR opened against the team trunk (`claude/ecstatic-gates-oHkEg`), not against `main`.

## Notes
