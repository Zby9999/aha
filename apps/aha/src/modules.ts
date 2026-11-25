import { readFileSync } from "node:fs";
import { createBackgroundAgent, createPiAgentHost, createStubAgentHost, createStubBackgroundAgent } from "@aha/agent-host";
import type { AhaModules, TimelineEntry } from "@aha/contracts";
import { createDecisions, createStubDecisions, jevConfig } from "@aha/decisions";
import { createStubLearnerModel } from "@aha/learner-model";
import { createStubTeaching } from "@aha/teaching";

export type Implementation = "stub" | "real";
export type ModuleConfig = Record<keyof AhaModules, Implementation>;

export interface BuildContext {
  /** Session the stub agent host replays. */
  script?: readonly TimelineEntry[];
  /** Delay between streamed words of the stub agent; 0 sends whole messages. */
  streamDelayMs?: number;
}

type Registry = { [K in keyof AhaModules]: Partial<Record<Implementation, (ctx: BuildContext) => AhaModules[K]>> };

/**
 * Every module's implementations. A module owner adds `real` here when their implementation lands;
 * until then asking for it fails with a clear message.
 */
const REGISTRY: Registry = {
  agentHost: {
    stub: (ctx) => createStubAgentHost({ script: ctx.script ?? [], streamDelayMs: ctx.streamDelayMs ?? 0 }),
    // The user's own Pi in RPC mode: `pi` on the PATH, or AHA_PI_COMMAND.
    real: () => createPiAgentHost(),
  },
  decisions: { stub: () => createStubDecisions(), real: () => createDecisions(jevConfig(process.env)) },
  learnerModel: { stub: () => createStubLearnerModel },
  teaching: { stub: () => createStubTeaching },
  background: { stub: () => createStubBackgroundAgent(), real: () => createBackgroundAgent() },
};

export const MODULE_KEYS = Object.keys(REGISTRY) as (keyof AhaModules)[];

export function buildModules(config: ModuleConfig, ctx: BuildContext = {}): AhaModules {
  const build = <K extends keyof AhaModules>(key: K): AhaModules[K] => {
    const factory = REGISTRY[key][config[key]];
    if (!factory) throw new Error(`No ${config[key]} implementation of ${key} yet. Set it to "stub" in aha.config.json or AHA_${envName(key)}.`);
    return factory(ctx);
  };
  return {
    agentHost: build("agentHost"),
    decisions: build("decisions"),
    learnerModel: build("learnerModel"),
    teaching: build("teaching"),
    background: build("background"),
  };
}

/** Reads aha.config.json, then lets AHA_AGENT_HOST, AHA_DECISIONS, ... (stub | real) override each module. */
export function readConfig(file: string, env: NodeJS.ProcessEnv = process.env): ModuleConfig {
  const fromFile = JSON.parse(readFileSync(file, "utf8")) as Partial<ModuleConfig>;
  const config = {} as ModuleConfig;
  for (const key of MODULE_KEYS) {
    const value = env[`AHA_${envName(key)}`] ?? fromFile[key] ?? "stub";
    if (value !== "stub" && value !== "real") throw new Error(`${key} must be "stub" or "real", got "${value}"`);
    config[key] = value;
  }
  return config;
}

function envName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}
