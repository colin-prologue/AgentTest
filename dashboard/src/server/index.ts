/**
 * Dashboard HTTP server (Layer 0 skeleton).
 *
 * For now this only serves `GET /health` so the agent team can verify the
 * package boots. Layers 1–6 will add SQLite-backed endpoints, SSE streaming,
 * frontend static serving, and the control API on top of this same server.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const DEFAULT_PORT = 7777;

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid PORT env var: ${raw}`);
  }
  return n;
}

function pathFromUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return "/";
  // URL needs a base to parse relative request-target — host doesn't matter.
  const u = new URL(rawUrl, "http://localhost");
  return u.pathname;
}

export function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const path = pathFromUrl(req.url);

  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found", path }));
}

export function startServer(port: number = parsePort(process.env.PORT)): ReturnType<typeof createServer> {
  const server = createServer(handleRequest);
  server.listen(port, () => {
    console.log(`dashboard server listening on http://localhost:${port}`);
  });
  return server;
}

// Run when invoked directly (tsx / node).
// We compare argv[1] against this file's URL to avoid double-start when imported.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const entryUrl = new URL(`file://${entry.replace(/\\/g, "/")}`).href;
    return entryUrl === import.meta.url;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const server = startServer();
  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`dashboard server received ${signal}, closing`);
    server.close((err) => {
      if (err) {
        console.error("error during shutdown", err);
        process.exit(1);
      }
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
