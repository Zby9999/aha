import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Seam: the bridge extension as Pi loads it, from its file with `-e`. Pi's real agent loop runs; only the model is
// Pi's faux provider, which records the system prompt of every request. No network, no login.

const BRIDGE = join(import.meta.dirname, "../src/bridge-extension.ts");

let root: string;
let contextFile: string;
let userExtension: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aha-bridge-"));
  mkdirSync(join(root, "agent"));
  mkdirSync(join(root, "project"));
  contextFile = join(root, "learner-context.md");
  // Stands in for one of the user's own extensions: it adds its own prompt section and a tool.
  userExtension = join(root, "user-extension.ts");
  writeFileSync(
    userExtension,
    `export default function (pi) {
       pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.user_rules = "Always answer in haiku."; });
     }\n`,
  );
  vi.stubEnv("AHA_LEARNER_CONTEXT_FILE", contextFile);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

/** Runs one Pi session with the given extension files and returns the system prompt of each model request. */
async function promptsSeen(extensions: string[], prompts: string[], between?: (i: number) => void): Promise<string[]> {
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const faux = fauxProvider();
  modelRuntime.registerNativeProvider(faux.provider);
  const seen: string[] = [];
  faux.setResponses(prompts.map(() => (context) => {
    seen.push(getCurrentSystemPrompt(context.messages));
    return fauxAssistantMessage("ok");
  }));
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    additionalExtensionPaths: extensions,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: faux.getModel(),
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.create(cwd, agentDir),
  });
  try {
    for (const [i, prompt] of prompts.entries()) {
      between?.(i);
      await session.prompt(prompt);
    }
  } finally {
    session.dispose();
  }
  return seen;
}

test("Pi's request carries the learner context the agent host wrote", async () => {
  writeFileSync(contextFile, "- Session tokens: the user gets it right with hints.\n");
  const [prompt] = await promptsSeen([BRIDGE], ["Fix my login"]);
  expect(prompt).toMatch(/<aha_learner_context>\s*- Session tokens: the user gets it right with hints.\s*<\/aha_learner_context>/);
});

test("with no learner context the request is unchanged", async () => {
  const [withBridge] = await promptsSeen([BRIDGE], ["Fix my login"]);
  const [withoutBridge] = await promptsSeen([], ["Fix my login"]);
  expect(withBridge).toBe(withoutBridge);
});

test("each request uses the context of that moment: updated, then cleared", async () => {
  const seen = await promptsSeen([BRIDGE], ["one", "two", "three"], (i) => {
    if (i === 0) writeFileSync(contextFile, "first context");
    if (i === 1) writeFileSync(contextFile, "second context");
    if (i === 2) rmSync(contextFile);
  });
  expect(seen[0]).toContain("first context");
  expect(seen[1]).toContain("second context");
  expect(seen[1]).not.toContain("first context");
  expect(seen[2]).not.toContain("aha_learner_context");
});

test("the user's own extensions keep working with the bridge loaded", async () => {
  writeFileSync(contextFile, "learner context");
  const [prompt] = await promptsSeen([userExtension, BRIDGE], ["Fix my login"]);
  expect(prompt).toContain("Always answer in haiku.");
  expect(prompt).toContain("learner context");
});
