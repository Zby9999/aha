import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  // The same `@/` alias as the Vite build, so tests can load UI modules that use it.
  resolve: { alias: { "@": fileURLToPath(new URL("./ui", import.meta.url)) } },
  test: {
    name: "app",
  },
});
