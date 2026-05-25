# dashboard

Visualization dashboard for the agent team (PM / Engineer / Reviewer / Tester). This package is the foundation skeleton — only `GET /health` is wired up. Layers 1–6 (event store, SSE, timeline view, board view, audit drawer, interrupt API) build on top of it; see `design/dashboard.md` for the full spec.

## Run

From the repo root, `npm run dashboard:dev` starts the Node HTTP server on `http://localhost:7777` (override with `PORT=<n>`). Verify with `curl -s http://localhost:7777/health` — it should return `{"status":"ok"}`. The frontend dev server is separate: `cd dashboard && npm install && npm run dev:frontend` boots Vite on `http://localhost:5173` and renders a placeholder `<h1>Dashboard</h1>`. Frontend and server are intentionally not wired together yet — that happens in Layer 3.
