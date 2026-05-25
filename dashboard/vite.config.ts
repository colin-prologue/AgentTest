import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, "src/frontend"),
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: resolve(here, "dist/frontend"),
    emptyOutDir: true,
  },
});
