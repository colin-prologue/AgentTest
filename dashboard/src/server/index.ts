import http from "node:http";

// Stub Node server for the dashboard.
//
// This is the skeleton from task-001. It currently only serves GET /health so
// that ops + later layers have something to hit while the rest of the stack
// (SQLite store, ingest worker, SSE endpoint, REST routes, SPA) is built out.
//
// Listens on PORT (default 7777). All other paths return 404.

const PORT = Number(process.env.PORT ?? 7777);

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  contentType = "application/json",
): void {
  const payload =
    typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  if (method === "GET" && url === "/health") {
    send(res, 200, { ok: true });
    return;
  }

  send(res, 404, { ok: false, error: "not_found", path: url });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[dashboard] stub server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[dashboard] try: curl http://localhost:${PORT}/health`);
});

// Graceful shutdown so `npm run dashboard:dev` exits cleanly on Ctrl-C.
function shutdown(signal: NodeJS.Signals): void {
  // eslint-disable-next-line no-console
  console.log(`[dashboard] received ${signal}, closing server…`);
  server.close(() => process.exit(0));
  // Hard exit after 5s if connections refuse to close.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
