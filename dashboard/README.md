# Dashboard

Visualization layer for the agent team. This package is built up in numbered layers per [`design/dashboard.md`](../design/dashboard.md): SQLite event store → ingest → SSE server → SPA views (timeline, board, audit drawer) → interrupt API.

**Stack:** React + Vite for the SPA, plain Node `http` for the server (no framework — kept minimal so the surface area matches the design doc and is easy to audit). TypeScript everywhere; `tsx` runs the server in dev. SQLite (`better-sqlite3`) lands in task-002.

## Current state

Skeleton only. The server (`src/server/index.ts`) listens on `PORT` (default `7777`) and answers `GET /health` with `{"ok":true}`. Everything else 404s. The SPA entry (`src/web/`) is a placeholder so the Vite build tooling is wired but renders nothing useful yet.

## Scripts

From the repo root:

```bash
npm run dashboard:dev      # start the stub server in the foreground (tsx)
```

From `dashboard/`:

```bash
npm run dev:server   # same as dashboard:dev
npm run dev:web      # vite dev server for the SPA (proxies to :7777)
npm run build:web    # production SPA build
npm run typecheck    # tsc --noEmit
```

## Quick check

```bash
npm run dashboard:dev &
curl -i http://localhost:7777/health
# HTTP/1.1 200 OK
# {"ok":true}
```
