import { join } from "node:path";
import { createBackend, startServer } from "@aha/app";
import { demoSession } from "@aha/contracts/fixtures";
import { buildModules, readConfig } from "./modules.ts";
import { replayUntilOffer } from "./replay.ts";

const here = import.meta.dirname;
const config = readConfig(join(here, "../aha.config.json"));
const projectDir = process.env.AHA_PROJECT_DIR ?? join(here, "../../../examples/portfolio");
const port = Number(process.env.PORT ?? 4317);

const backend = await createBackend({ modules: buildModules(config, { script: demoSession }), projectDir, sessionId: "local-1" });
if (config.agentHost === "stub" && process.env.AHA_REPLAY !== "off") await replayUntilOffer(backend, demoSession);

await startServer({ backend, port, uiDir: join(here, "../../../packages/app/dist/ui") });
console.log(`Aha is running at http://127.0.0.1:${port} (modules: ${JSON.stringify(config)})`);
