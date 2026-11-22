import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundAgentError, type BackgroundTool } from "@aha/contracts";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createBackgroundAgent } from "../src/index.ts";

// Seam: BackgroundAgent.run. Pi's real agent loop and built-in tools run; only the model is Pi's faux provider.

let agentDir: string;
let cwd: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "aha-bg-"));
  agentDir = join(root, "agent");
  cwd = join(root, "project");
  mkdirSync(agentDir);
  mkdirSync(join(cwd, ".aha"), { recursive: true });
});

async function agentScripted(responses: FauxResponseStep[]) {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
  const faux = fauxProvider();
  modelRuntime.registerNativeProvider(faux.provider);
  faux.setResponses(responses);
  return createBackgroundAgent({ agentDir, modelRuntime, model: faux.getModel() });
}

const toolUse = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

function request(tools: readonly BackgroundTool[], extra: object = {}) {
  return { cwd, tools, systemPrompt: "You consolidate a learner model.", prompt: "Go.", ...extra };
}

describe("tool allow-list", () => {
  test("returns the agent's final text", async () => {
    const agent = await agentScripted([fauxAssistantMessage("All done.")]);
    await expect(agent.run(request(["read"]))).resolves.toEqual({ text: "All done.", filesWritten: [] });
  });

  test("a shell call fails even though the model asks for it", async () => {
    const agent = await agentScripted([toolUse("bash", { command: "touch pwned" }), fauxAssistantMessage("ok")]);
    await agent.run(request(["read", "write", "edit"]));
    expect(existsSync(join(cwd, "pwned"))).toBe(false);
  });

  test("asking for shell in the allow-list is refused before Pi starts", async () => {
    const agent = await agentScripted([fauxAssistantMessage("never")]);
    const run = agent.run(request(["read", "bash" as BackgroundTool]));
    await expect(run).rejects.toBeInstanceOf(BackgroundAgentError);
    await expect(run).rejects.toMatchObject({ code: "tool_not_allowed" });
  });

  test("a tool left off the allow-list is unavailable", async () => {
    const agent = await agentScripted([toolUse("write", { path: "x.md", content: "x" }), fauxAssistantMessage("ok")]);
    const result = await agent.run(request(["read"]));
    expect(existsSync(join(cwd, "x.md"))).toBe(false);
    expect(result.filesWritten).toEqual([]);
  });
});

describe("writable folders", () => {
  test("writes inside a writable folder succeed and are reported", async () => {
    const agent = await agentScripted([
      toolUse("write", { path: ".aha/learner-model/index.md", content: "# Learner model" }),
      fauxAssistantMessage("written"),
    ]);
    const result = await agent.run(request(["read", "write"], { writableDirs: [".aha"] }));
    expect(readFileSync(join(cwd, ".aha/learner-model/index.md"), "utf8")).toBe("# Learner model");
    expect(result.filesWritten).toEqual([".aha/learner-model/index.md"]);
  });

  test("writes outside the writable folders are blocked", async () => {
    const agent = await agentScripted([
      toolUse("write", { path: "src/app.js", content: "hacked" }),
      toolUse("write", { path: "../escape.md", content: "x" }),
      fauxAssistantMessage("tried"),
    ]);
    const result = await agent.run(request(["write"], { writableDirs: [".aha"] }));
    expect(existsSync(join(cwd, "src/app.js"))).toBe(false);
    expect(existsSync(join(cwd, "../escape.md"))).toBe(false);
    expect(result.filesWritten).toEqual([]);
  });
});

describe("credentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("reports a clear error when Pi has no logged-in provider", async () => {
    // Hide provider keys from the environment so only the (empty) auth file counts.
    for (const name of Object.keys(process.env)) {
      if (/(_API_KEY|_TOKEN|_KEY)$/.test(name)) vi.stubEnv(name, undefined);
    }
    const agent = createBackgroundAgent({ agentDir });
    const run = agent.run(request(["read"]));
    await expect(run).rejects.toMatchObject({ code: "not_logged_in" });
    await expect(run).rejects.toThrow(/pi auth login/);
  });
});

test("an aborted run rejects with code aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const agent = await agentScripted([fauxAssistantMessage("late")]);
  await expect(agent.run(request(["read"], { signal: controller.signal }))).rejects.toMatchObject({ code: "aborted" });
});
