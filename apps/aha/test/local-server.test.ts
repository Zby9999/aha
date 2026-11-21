import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend, isLocalOrigin, startServer } from "@aha/app";
import type { ServerMessage } from "@aha/contracts";
import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { buildModules, MODULE_KEYS, type ModuleConfig } from "../src/modules.ts";

const projectDir = join(import.meta.dirname, "../../../examples/portfolio");
const allStubs = Object.fromEntries(MODULE_KEYS.map((k) => [k, "stub"])) as ModuleConfig;
let server: Server | undefined;

afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function start() {
  const backend = await createBackend({ modules: buildModules(allStubs, { script: [] }), projectDir, sessionId: "s-local" });
  server = await startServer({ backend, port: 0, uiDir: mkdtempSync(join(tmpdir(), "aha-ui-")) });
  return server.address() as AddressInfo;
}

/** Resolves with the first message, or rejects with the HTTP status if the upgrade is refused. */
function connect(port: number, origin?: string): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {});
    socket.once("message", (data) => {
      socket.close();
      resolve(JSON.parse(String(data)) as ServerMessage);
    });
    socket.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    socket.once("error", reject);
  });
}

describe("local-only server", () => {
  test("listens on loopback by default", async () => {
    expect((await start()).address).toBe("127.0.0.1");
  });

  test("accepts a socket from the app's own page", async () => {
    const { port } = await start();
    await expect(connect(port, `http://127.0.0.1:${port}`)).resolves.toMatchObject({ type: "snapshot" });
    await expect(connect(port, `http://localhost:${port}`)).resolves.toMatchObject({ type: "snapshot" });
  });

  test("refuses a socket from another website or with no Origin", async () => {
    const { port } = await start();
    await expect(connect(port, "https://evil.example")).rejects.toThrow("HTTP 401");
    await expect(connect(port, "http://127.0.0.1:1")).rejects.toThrow("HTTP 401");
    await expect(connect(port)).rejects.toThrow("HTTP 401");
  });

  test("isLocalOrigin only accepts http on a loopback host at the app's port", () => {
    expect(isLocalOrigin("http://[::1]:4317", 4317)).toBe(true);
    expect(isLocalOrigin("https://localhost:4317", 4317)).toBe(false);
    expect(isLocalOrigin("http://192.168.1.5:4317", 4317)).toBe(false);
    expect(isLocalOrigin("null", 4317)).toBe(false);
  });
});
