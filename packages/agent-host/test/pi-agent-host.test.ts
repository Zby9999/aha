import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHostError, createTimeline, type AgentSession, type Timeline } from "@aha/contracts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createPiAgentHost, type PiAgentHostOptions } from "../src/index.ts";

// Seam: AgentHost.startSession / AgentSession. Pi is a fake process speaking the RPC protocol (test/fake-pi.mjs).

const FAKE_PI = join(import.meta.dirname, "fake-pi.mjs");

let projectDir: string;
let log: string;
let timeline: Timeline;
const sessions: AgentSession[] = [];

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aha-pi-")));
  projectDir = root;
  log = join(root, "fake-pi.log");
  timeline = createTimeline({ sessionId: "s" });
});

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.stop()));
});

function host(env: Record<string, string> = {}, options: PiAgentHostOptions = {}) {
  return createPiAgentHost({
    command: process.execPath,
    args: [FAKE_PI],
    env: { ...process.env, FAKE_PI_LOG: log, ...env },
    ...options,
  });
}

async function start(env: Record<string, string> = {}, options: PiAgentHostOptions = {}) {
  const session = await host(env, options).startSession({ projectDir, timeline });
  sessions.push(session);
  return session;
}

const received = () =>
  existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];

const waitFor = async (check: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("starting Pi", () => {
  test("runs Pi in RPC mode in the project folder", async () => {
    await start();
    const [startRecord] = received();
    expect(startRecord).toMatchObject({ type: "__start__", cwd: projectDir });
    expect(startRecord!.argv).toEqual(expect.arrayContaining(["--mode", "rpc"]));
  });

  test("a missing Pi is reported with how to install it", async () => {
    const run = createPiAgentHost({ command: join(projectDir, "no-such-pi") }).startSession({ projectDir, timeline });
    await expect(run).rejects.toBeInstanceOf(AgentHostError);
    await expect(run).rejects.toMatchObject({ code: "pi_missing" });
    await expect(run).rejects.toThrow(/npm install -g @earendil-works\/pi-coding-agent/);
  });

  test("a Pi with no logged-in provider is reported with how to log in", async () => {
    const run = start({ FAKE_PI_MODELS: "none" });
    await expect(run).rejects.toMatchObject({ code: "not_logged_in" });
    await expect(run).rejects.toThrow(/pi auth login/);
  });

  test("a Pi with providers but no usable model is reported as not logged in", async () => {
    await expect(start({ FAKE_PI_MODELS: "no-default" })).rejects.toMatchObject({ code: "not_logged_in" });
  });

  test("a Pi that exits while starting is reported with its error output", async () => {
    const run = start({ FAKE_PI_ON_START: "exit" });
    await expect(run).rejects.toMatchObject({ code: "start_failed" });
    await expect(run).rejects.toThrow(/failed to start/);
  });

  test("a Pi that never answers is reported after the start timeout", async () => {
    const run = start({ FAKE_PI_ON_START: "silent" }, { startTimeoutMs: 200 });
    await expect(run).rejects.toMatchObject({ code: "start_failed" });
  });

  test("starting writes nothing to the Timeline", async () => {
    await start();
    expect(timeline.entries()).toEqual([]);
  });
});

describe("sending a message", () => {
  test("appends the user message and prompts Pi with it", async () => {
    const session = await start();
    await session.sendUserMessage("Fix my login");
    expect(timeline.entries()).toMatchObject([{ kind: "user_message", source: "agent-host", text: "Fix my login" }]);
    expect(received()).toContainEqual(expect.objectContaining({ type: "prompt", message: "Fix my login" }));
  });
});

describe("when Pi crashes", () => {
  test("the Timeline gets an agent error and a session end, and nothing throws", async () => {
    const session = await start();
    await expect(session.sendUserMessage("__crash__")).resolves.toBeUndefined();
    await waitFor(() => timeline.entries().some((e) => e.kind === "session_end"));

    const kinds = timeline.entries().map((e) => e.kind);
    expect(kinds.slice(-2)).toEqual(["error", "session_end"]);
    expect(timeline.entries().at(-2)).toMatchObject({ kind: "error", origin: "agent", message: expect.stringMatching(/Pi stopped/) });
    expect(timeline.entries().at(-1)).toMatchObject({ kind: "session_end", source: "agent-host", reason: "agent_exit" });
  });

  test("later messages are refused with a clear error instead of hanging", async () => {
    const session = await start();
    await session.sendUserMessage("__crash__").catch(() => {});
    await waitFor(() => timeline.entries().some((e) => e.kind === "session_end"));
    await expect(session.sendUserMessage("hello?")).rejects.toMatchObject({ code: "crashed" });
  });
});

describe("stopping", () => {
  test("stops Pi without writing a crash to the Timeline, and is safe to call twice", async () => {
    const session = await start();
    await session.stop();
    await session.stop();
    expect(timeline.entries()).toEqual([]);
    await expect(session.sendUserMessage("after stop")).rejects.toThrow(/stopped/);
  });
});
