# Review: task-001-dashboard-skeleton

**Verdict: approved**

PR #2 (`task/task-001-dashboard-skeleton` → `claude/ecstatic-gates-oHkEg`). Two commits: `feat(dashboard): skeleton package + /health endpoint (task-001)` and `fix(hooks): restrict agent pushes to task/* branches only`.

## Acceptance criteria

### `dashboard/package.json` exists with `name: "dashboard"`, TypeScript devDep, Vite devDep, `"type": "module"` — PASS
All present: `name: "dashboard"`, `"type": "module"`, `typescript ^5.3.0` and `vite ^5.4.0` in `devDependencies`, plus `tsx`, `@vitejs/plugin-react`, React/ReactDOM, and a Node ≥20 engine constraint.

### `dashboard/tsconfig.json` extends a sane base (strict, Bundler for frontend, NodeNext for server) — PASS
Project-references config at the root plus `tsconfig.server.json` (`module: NodeNext`, `moduleResolution: NodeNext`, `types: ["node"]`) and `tsconfig.frontend.json` (`module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, `types: ["vite/client"]`). Strict mode in the shared root config. Matches the criterion exactly.

### `dashboard/src/server/index.ts` boots on 7777 (PORT override) and returns 200 `{"status":"ok"}` on `GET /health` — PASS
- Default port `7777`, `PORT` env override with validation rejecting non-integers / out-of-range values (1–65535).
- `handleRequest` exported and pure; `req.method === "GET" && path === "/health"` returns `200` with `Content-Type: application/json` and body `{"status":"ok"}`.
- 404 fallback with structured JSON error.
- `invokedDirectly` guard plus SIGINT/SIGTERM shutdown handlers — extras, not required.

### `dashboard/src/frontend/` minimal Vite React app rendering `<h1>Dashboard</h1>` — PASS
`main.tsx` mounts `<App />` via `createRoot` in `StrictMode` with a null-check on `#root`. `App.tsx` returns `<h1>Dashboard</h1>` (literal text). `index.html` loads `main.tsx` as a module against `<div id="root">`. `vite.config.ts` roots the dev server at `src/frontend` and emits to `dist/frontend`.

### Root `package.json` `npm run dashboard:dev` starts the server — PASS
`"dashboard:dev": "tsx dashboard/src/server/index.ts"` at the root level.

### `curl -s http://localhost:7777/health` returns `{"status":"ok"}` when running — PASS (code level)
Server clearly produces that exact body. Runtime verification is the tester's job.

### `dashboard/README.md` (one paragraph) explains how to run server + frontend dev server — PASS
Two short paragraphs (intro + Run section); within spirit of "one paragraph." Covers `npm run dashboard:dev`, the `PORT` override, the `curl` health check, and `npm run dev:frontend` for Vite on port 5173. Nit only — not a blocker.

### PR opened against the team trunk (`claude/ecstatic-gates-oHkEg`), not against `main` — PASS
`gh pr view 2`: `baseRefName: "claude/ecstatic-gates-oHkEg"`, `headRefName: "task/task-001-dashboard-skeleton"`.

## Out-of-scope change (non-blocking)

`agents/shared/hooks.ts` gains an extra denylist entry: `git push <…> origin <ref>` where `<ref>` is not `task/*` is now blocked. This tightens the existing protection (which only blocked `main`/`master`) so engineers can only push to `task/*` branches. Pattern correctly allows the common forms (`git push -u origin task/foo`, `git push origin task/foo`, `git push origin HEAD:task/foo`) and blocks trunk / tag / deletion / `HEAD:main` pushes.

Not part of the acceptance criteria — strictly speaking, scope creep. However, it tightens (does not loosen) the safety net, is consistent with the rule in `CLAUDE.md` ("engineer **never** pushes to `main` or `master`"), and is harmless to layer 1 work. **Allowing this through, but please keep ancillary safety changes in their own task next time so reviewers can scrutinize them in isolation.**

## Bugs / security / secrets / tests

- No secrets in the diff.
- No untrusted-input handling concerns — the server matches one exact path and returns a static JSON body.
- No tests added. Acceptance criteria don't require any for this layer-0 skeleton; runtime verification is the tester's job. Not blocking.
- `JSX.Element` return type on `App` works in React 18.3 types; no action needed.

## Action

Status updated to `approved`. Cleared for tester to perform runtime verification.
