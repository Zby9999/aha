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
let stopping = false;
const shutdown = async (code = 0) => {
  // A second Ctrl-C quits at once.
  if (stopping) process.exit(code);
  stopping = true;
  if (backend) {
    // Ending the session runs Dreaming, so what was learned reaches the Concept files. It never holds the exit for long.
    console.log("Ending the session: updating the learner model (Ctrl-C again to quit now)…");
    const dreamed = backend.dispatch({ type: "end_session" }).then(() => backend!.settled());
    await Promise.race([dreamed.catch(console.error), new Promise((resolve) => setTimeout(resolve, 60_000).unref())]);
  }
  await Promise.allSettled([backend?.stop(), preview?.stop()]);
  process.exit(code);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

try {
  backend = await createBackend({
    modules: buildModules(config, { script: demoSession, streamDelayMs: Number(process.env.AHA_STREAM_DELAY_MS ?? 40) }),
    projectDir,
    // One id per run: Evidence ids restart at ev-1 in each session, so a restart must not append to the last file.
    sessionId: `local-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
  });
  await startServer({ backend, port, uiDir: join(here, "../../../packages/app/dist/ui"), previewUrl: preview?.url ?? null });
} catch (error) {
  // Pi missing, not logged in or failing to start: the message says what to do.
  if (error instanceof AgentHostError) console.error(`\nAha could not start your agent.\n${error.message}\n`);
  else console.error(error);
  stopping = true;
  await Promise.allSettled([backend?.stop(), preview?.stop()]);
  process.exit(1);
}
console.log(`Aha is running at http://127.0.0.1:${port} (modules: ${JSON.stringify(config)})`);
if (preview) console.log(`Live preview of ${projectDir} at ${preview.url}`);

// Replay after the server is up, so an open page shows the agent's replies streaming in.
if (backend && !realAgent && process.env.AHA_REPLAY !== "off") await replayUntilOffer(backend, demoSession);
