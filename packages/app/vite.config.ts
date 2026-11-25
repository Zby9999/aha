import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: "ui",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./ui", import.meta.url)) } },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    rolldownOptions: {
      input: [fileURLToPath(new URL("./ui/index.html", import.meta.url)), fileURLToPath(new URL("./ui/gallery.html", import.meta.url))],
    },
  },
  // `pnpm dev:ui` talks to a backend started with `pnpm start` in apps/aha.
  // The backend only accepts its own Origin, so the proxy presents it.
  server: { proxy: { "/ws": { target: "ws://127.0.0.1:4317", ws: true, headers: { origin: "http://127.0.0.1:4317" } } } },
});
