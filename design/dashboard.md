# Agent Visualization Dashboard — Design Spec

This is the architectural spec for the visualization system. The agent team is implementing it.

## Goal

Give a human operator three things, in order of priority:

1. **Quick check-in**: "what are my agents doing right now?" — at-a-glance progress across the whole team.
2. **Quick scan of history**: "how did we get here?" — readable timeline of who did what when.
3. **Audit + interruption**: "where did they go off track and how do I steer?" — drill into any event, see causality, pause/note/rewind/kill an agent.

## Architecture (top-down)

```
┌─────────────────────────────────────────────────┐
│  Frontend (React or SvelteKit, SPA)             │
│   - Board view      (task DAG, live status)     │
│   - Timeline view   (per-agent swimlanes)       │
│   - Audit drawer    (event detail + causality)  │
│   - Interrupt API   (pause / note / rewind)     │
└──────────────────────┬──────────────────────────┘
                       │ SSE for live events, REST for history & blobs
┌──────────────────────▼──────────────────────────┐
│  Server (Node, single binary)                   │
│   - SSE endpoint streaming new events           │
│   - REST: /events, /events/:id, /blobs/:hash    │
│   - REST: /tasks (derived from tasks/*.md)      │
│   - REST: /control (pause/note/rewind/kill)     │
└──────────────────────┬──────────────────────────┘
                       │ reads from
┌──────────────────────▼──────────────────────────┐
│  Store (SQLite, WAL mode)                       │
│   - events table (ingested from events/*.jsonl) │
│   - blobs on disk under events/blobs/           │
└──────────────────────▲──────────────────────────┘
                       │ ingested from
┌──────────────────────┴──────────────────────────┐
│  Capture (already exists — agents/shared/hooks) │
│   - events/<agent>.jsonl                        │
│   - tasks/*.md, goals/*.md, control/*           │
└─────────────────────────────────────────────────┘
```

The capture layer is **already shipped** in `agents/shared/hooks.ts` and `agents/shared/events.ts`. Everything below SQLite is the agents' job to build.

## Event schema (already defined, do not change without coordination)

See `agents/shared/events.ts` for the canonical `AgentEvent` type. Key fields:

- `event_id` — primary key
- `parent_event_id` — optional; for causality chains (e.g. a tool result links back to the assistant turn that produced it). The hook layer doesn't populate this yet; the dashboard's ingest layer may infer it from session_id + timestamp ordering, OR a later task can extend the hooks to populate it explicitly.
- `agent_id`, `session_id`, `task_id`
- `ts` — ISO timestamp
- `type` — one of: `session_start`, `session_end`, `pre_tool_use`, `post_tool_use`, `stop`, `tick_start`, `tick_end`, `decision`, `handoff`, `blocker`, `error`
- `payload` — type-specific
- `blob_ref` — sha256 hash; full content at `events/blobs/<hash>.txt`

## Layers (build in this order — each must be working before the next starts)

### Layer 1: Event store + ingest

**Acceptance**:
- [ ] SQLite database at `dashboard/data/events.db` with schema for the `AgentEvent` shape above.
- [ ] An ingest process that tails all `events/*.jsonl` files and writes new lines into SQLite. Survives restarts (resumes from last-ingested offset per file).
- [ ] CLI command (`npm run dashboard:ingest`) starts ingest in the foreground.
- [ ] Manually appending a line to `events/test.jsonl` causes a new row in SQLite within 1 second.
- [ ] Re-running ingest does not duplicate rows (idempotent on `event_id`).

### Layer 2: SSE server

**Acceptance**:
- [ ] HTTP server on port 7777 (configurable via env).
- [ ] `GET /events?since=<event_id>&agent=<id>&limit=<n>` returns JSON array of historical events.
- [ ] `GET /events/stream` is an SSE endpoint that pushes every new event ingested.
- [ ] `GET /blobs/:hash` returns the blob content for a given hash.
- [ ] `GET /tasks` returns the current task board parsed from `tasks/*.md` (frontmatter + body summary).
- [ ] Starting the server with no events present, then triggering an agent tick, results in events arriving over SSE within 2 seconds.

### Layer 3: Timeline view (swimlanes)

**Acceptance**:
- [ ] React or Svelte SPA served at `http://localhost:7777/`.
- [ ] One horizontal swimlane per agent (pm, engineer, reviewer, tester).
- [ ] X-axis is time; each event is a small rectangle, color-coded by tool type (file ops, bash, MCP, decisions).
- [ ] Connects to `/events/stream` on load; new events appear in real time.
- [ ] Brushable time range (drag to zoom).
- [ ] Hovering an event shows tool name + brief preview. Clicking opens the audit drawer.
- [ ] Performance: handles ≥ 10k events without dropping below 30fps.

### Layer 4: Board view (task DAG)

**Acceptance**:
- [ ] Reads `/tasks`; renders one node per task.
- [ ] Nodes colored by status (unstarted / in_progress / review_pending / changes_requested / approved / completed / blocked).
- [ ] Edges from `dependsOn` relationships.
- [ ] In-progress nodes show a live "activity dot" (animated when there's been a tool_use event for that task in the last 30s).
- [ ] Click a node → opens the task file in a side panel.
- [ ] Refreshes within 2 seconds of a task file changing.

### Layer 5: Audit drawer

**Acceptance**:
- [ ] Click any event in timeline or board → drawer opens on the right.
- [ ] Drawer shows: full payload (pretty-printed), blob content if present, parent event link if known, list of child events (events with same session_id within 60s after).
- [ ] "Jump to context" button shows the surrounding events in the timeline.
- [ ] "View diff" button if the event is a file edit — shows the diff inline.

### Layer 6: Interrupt API

**Acceptance**:
- [ ] `POST /control/pause/:agent_id` — creates `control/pause-<agent_id>`. Returns 200.
- [ ] `POST /control/resume/:agent_id` — deletes that file. Returns 200.
- [ ] `POST /control/note/:task_id` with body `{ note: string }` — appends a `## Notes` entry to that task file.
- [ ] `POST /control/rewind/:agent_id` with body `{ to_event_id: string }` — kills the agent's current session, clears `agents-state/<agent>.session`, optionally restores a saved earlier session id. Returns 200.
- [ ] `POST /control/kill/:agent_id` — sends SIGTERM to the agent process (server tracks PIDs via a pidfile written by the runner).
- [ ] UI: buttons on each swimlane (pause/resume/kill) and on each task (add note).

## Non-goals (don't build these yet)

- Multi-machine event ingest (a single host is fine).
- Auth / multi-user. This is local-only for now.
- Persistent dashboards across machines. Just runs locally.
- Replay-from-scratch UI. Querying historical events is fine; full deterministic replay is later.

## Constraints

- Single host, single SQLite DB.
- All paths relative to repo root.
- Frontend assets served by the same Node process — no separate dev server in production mode (dev mode can use Vite).
- No external services (no Redis, no Postgres, no S3) for the bootstrap version.

## Pitfalls to plan for

- **Blob bloat**: cumulative tool I/O can exceed 100 MB/day. Add a retention task in Layer 1: blobs older than 7 days for completed tasks get deleted.
- **SSE reconnect**: clients should reconnect on disconnect with `Last-Event-ID`.
- **Concurrent writes**: SQLite WAL mode handles this, but only one ingest process should run at a time. Use a pidfile lock.
- **Big timelines**: at >10k events, virtualize the swimlane render. Use a canvas/Pixi layer if SVG chokes.
