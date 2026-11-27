import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend, startServer } from "@aha/app";
import type { AgentSettings, ServerMessage } from "@aha/contracts";
import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { buildModules, MODULE_KEYS, type ModuleConfig } from "../src/modules.ts";

// Seam: the backend's set_model action and agent settings, and the agent_settings server message.

const projectDir = join(import.meta.dirname, "../../../examples/portfolio");
const allStubs = Object.fromEntries(MODULE_KEYS.map((k) => [k, "stub"])) as ModuleConfig;
let server: Server | undefined;

afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

const backend = () => createBackend({ modules: buildModules(allStubs, { script: [] }), projectDir, sessionId: "s-settings" });

describe("agent settings", () => {
  test("lists the agent's models, current model and commands", async () => {
    const settings = await (await backend()).agentSettings();
    expect(settings.currentModel).toMatchObject({ provider: "stub", id: "stub-fast" });
    expect(settings.models.map((m) => m.id)).toEqual(["stub-fast", "stub-smart"]);
    expect(settings.commands.map((c) => c.name)).toContain("fix-tests");
  });

  test("set_model switches the agent's model and tells listeners", async () => {
    const b = await backend();
    const seen: AgentSettings[] = [];
    b.onAgentSettings((settings) => seen.push(settings));
    await b.dispatch({ type: "set_model", provider: "stub", modelId: "stub-smart" });
    expect(seen.map((s) => s.currentModel?.id)).toEqual(["stub-smart"]);
    expect((await b.agentSettings()).currentModel?.id).toBe("stub-smart");
  });

  test("an unknown model is rejected and the model stays", async () => {
    const b = await backend();
    await expect(b.dispatch({ type: "set_model", provider: "stub", modelId: "nope" })).rejects.toThrow();
    expect((await b.agentSettings()).currentModel?.id).toBe("stub-fast");
  });

  test("set_model is rejected in learning mode", async () => {
    const b = await backend();
    await b.dispatch({ type: "ask_why", text: "Why does the login fail?" });
    await expect(b.dispatch({ type: "set_model", provider: "stub", modelId: "stub-smart" })).rejects.toThrow(/after the Lesson/);
    await b.dispatch({ type: "back_to_work" });
    await b.settled();
    expect((await b.agentSettings()).currentModel?.id).toBe("stub-fast");
  });

  test("a slash command is sent to the agent as an ordinary message", async () => {
    const b = await backend();
    await b.dispatch({ type: "send_message", text: "/fix-tests" });
    expect(b.timeline.entries()).toContainEqual(expect.objectContaining({ kind: "user_message", source: "agent-host", text: "/fix-tests" }));
  });
});

describe("agent_settings over the socket", () => {
  test("is sent after the snapshot on connect, and again after the model changes", async () => {
    const b = await backend();
    server = await startServer({ backend: b, port: 0, uiDir: mkdtempSync(join(tmpdir(), "aha-ui-")) });
    const { port } = server.address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
    const messages: ServerMessage[] = [];
    const waitFor = (count: number) => new Promise<void>((resolve, reject) => {
      const check = () => (messages.length >= count ? resolve() : undefined);
      socket.on("message", (data) => { messages.push(JSON.parse(String(data)) as ServerMessage); check(); });
      socket.once("error", reject);
    });
    await waitFor(2);
    expect(messages.map((m) => m.type)).toEqual(["snapshot", "agent_settings"]);
    const settingsUpdate = new Promise<ServerMessage>((resolve) => socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === "agent_settings") resolve(message);
    }));
    socket.send(JSON.stringify({ type: "action", action: { type: "set_model", provider: "stub", modelId: "stub-smart" } }));
    const update = await settingsUpdate;
    expect(update.type === "agent_settings" && update.settings.currentModel?.id).toBe("stub-smart");
    socket.close();
  });
});
