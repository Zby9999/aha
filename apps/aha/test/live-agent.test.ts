import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend, startServer, type Backend } from "@aha/app";
import type { ServerMessage, TimelineEntry } from "@aha/contracts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import WebSocket from "ws";
import { buildModules, MODULE_KEYS, type ModuleConfig } from "../src/modules.ts";

// The real agent host wired into the app, with a fake Pi (packages/agent-host/test/fake-pi.mjs) that replays a Pi
// event stream after each prompt. Seam: the app's WebSocket, as the browser uses it.

const agentHostTests = join(import.meta.dirname, "../../../packages/agent-host/test");
const config = { ...(Object.fromEntries(MODULE_KEYS.map((k) => [k, "stub"])) as ModuleConfig), agentHost: "real" } satisfies ModuleConfig;

let root: string;
let backend: Backend | undefined;
let server: Server | undefined;
let socket: WebSocket | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aha-live-"));
  mkdirSync(join(root, "project/public"), { recursive: true });
  writeFileSync(join(root, "project/public/app.js"), "const sessionToken = Math.random().toString(36).slice(2);\n");
  vi.stubEnv("AHA_PI_COMMAND", join(agentHostTests, "fake-pi.mjs"));
  vi.stubEnv("FAKE_PI_EVENTS", join(agentHostTests, "fixtures/fix-login.rpc.jsonl"));
  vi.stubEnv("FAKE_PI_LOG", join(root, "pi.log"));
});

afterEach(async () => {
  socket?.terminate();
  socket = undefined;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await backend?.stop();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

test("a message typed in the app reaches Pi, and the reply and file edits stream back live", async () => {
  backend = await createBackend({ modules: buildModules(config), projectDir: join(root, "project"), sessionId: "live" });
  server = await startServer({ backend, port: 0, uiDir: root });
  const { port } = server.address() as AddressInfo;

  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
  const received: TimelineEntry[] = [];
  const done = new Promise<void>((resolve, reject) => {
    setTimeout(() => reject(new Error(`no final reply; got ${received.map((e) => e.kind).join(", ")}`)), 4000).unref();
    socket!.on("message", (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === "entry") received.push(message.entry);
      if (message.type === "entry" && message.entry.kind === "agent_message" && message.entry.text.startsWith("Done.")) resolve();
    });
  });
  await new Promise((resolve) => socket!.once("open", resolve));
  socket.send(JSON.stringify({ type: "action", action: { type: "send_message", text: "Fix my login" } }));
  await done;

  const prompts = readFileSync(join(root, "pi.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((c) => c.type === "prompt");
  expect(prompts).toMatchObject([{ message: "Fix my login" }]);
  const kinds = received.map((e) => e.kind);
  expect(kinds[0]).toBe("user_message");
  expect(kinds).toContain("agent_message_delta");
  expect(received.filter((e) => e.kind === "file_edit").map((e) => (e as { path: string }).path)).toEqual(["public/app.js", "public/token.js"]);
  // Deltas arrive before the complete reply, so the chat streams it.
  const first = received.findIndex((e) => e.kind === "agent_message_delta");
  expect(first).toBeLessThan(received.findIndex((e) => e.kind === "agent_message"));
});

test("a missing Pi stops the backend from starting with a clear message", async () => {
  vi.stubEnv("AHA_PI_COMMAND", join(root, "no-such-pi"));
  const start = createBackend({ modules: buildModules(config), projectDir: join(root, "project"), sessionId: "live" });
  await expect(start).rejects.toMatchObject({ code: "pi_missing", message: expect.stringMatching(/Install it with/) });
});
