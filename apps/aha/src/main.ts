import { join } from "node:path";
import { createBackend, startPreview, startServer } from "@aha/app";
import { AgentHostError } from "@aha/contracts";
import { demoSession } from "@aha/contracts/fixtures";
import { buildModules, readConfig } from "./modules.ts";
import { replayUntilOffer } from "./replay.ts";

const here = import.meta.dirname;
const config = readConfig(join(here, "../aha.config.json"));
const projectDir = process.env.AHA_PROJECT_DIR ?? join(here, "../../../examples/portfolio");
const port = Number(process.env.PORT ?? 4317);
const realAgent = config.agentHost === "real";

// Tech-validation live preview (#22): on by default with the real agent host; AHA_PREVIEW=on|off overrides.
const previewOn = (process.env.AHA_PREVIEW ?? (realAgent ? "on" : "off")) === "on";
const preview = previewOn ? startPreview({ projectDir, port: Number(process.env.AHA_PREVIEW_PORT ?? port + 1) }) : undefined;

let backend: Awaited<ReturnType<typeof createBackend>> | undefined;
const shutdown = async (code = 0) => {
  await Promise.allSettled([backend?.stop(), preview?.stop()]);
  process.exit(code);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  backend = await createBackend({
    modules: buildModules(config, { script: demoSession, streamDelayMs: Number(process.env.AHA_STREAM_DELAY_MS ?? 40) }),
    projectDir,
    sessionId: "local-1",
  });
  await startServer({ backend, port, uiDir: join(here, "../../../packages/app/dist/ui"), previewUrl: preview?.url ?? null });
} catch (error) {
  // Pi missing, not logged in or failing to start: the message says what to do.
  if (error instanceof AgentHostError) console.error(`\nAha could not start your agent.\n${error.message}\n`);
  else console.error(error);
  await shutdown(1);
}
console.log(`Aha is running at http://127.0.0.1:${port} (modules: ${JSON.stringify(config)})`);
if (preview) console.log(`Live preview of ${projectDir} at ${preview.url}`);

// Replay after the server is up, so an open page shows the agent's replies streaming in.
if (backend && !realAgent && process.env.AHA_REPLAY !== "off") await replayUntilOffer(backend, demoSession);
