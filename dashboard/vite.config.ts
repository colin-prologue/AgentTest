import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the dashboard SPA. The SPA itself is not built yet — this is
// just the build tooling so later layers (timeline view, board view) have
// somewhere to land.
export default defineConfig({
  plugins: [react()],
  root: "src/web",
  server: {
    port: 5173,
    proxy: {
      // During `vite dev` the SPA proxies to the Node server on 7777 so /events,
      // /events/stream, /blobs, /tasks all "just work" from the SPA's origin.
      "/health": "http://localhost:7777",
      "/events": "http://localhost:7777",
      "/blobs": "http://localhost:7777",
      "/tasks": "http://localhost:7777",
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});
