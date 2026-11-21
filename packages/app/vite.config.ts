import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "ui",
  plugins: [react()],
  build: { outDir: "../dist/ui", emptyOutDir: true },
  // `pnpm dev:ui` talks to a backend started with `pnpm start` in apps/aha.
  server: { proxy: { "/ws": { target: "ws://localhost:4317", ws: true } } },
});
