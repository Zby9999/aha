import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startPreview, type ProjectPreview } from "../src/index.ts";

// Seam: startPreview. A tiny project whose server.js answers with a version string.

let projectDir: string;
let preview: ProjectPreview | undefined;

afterEach(async () => {
  await preview?.stop();
  preview = undefined;
  rmSync(projectDir, { recursive: true, force: true });
});

const server = (version: string) =>
  `require("node:http").createServer((req, res) => res.end(${JSON.stringify(version)})).listen(process.env.PORT);\n`;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function fetchUntil(url: string, expected: string, ms = 8000): Promise<string> {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    try {
      last = await (await fetch(url)).text();
      if (last === expected) return last;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

test("serves the project and restarts it when the agent edits server.js", async () => {
  projectDir = mkdtempSync(join(tmpdir(), "aha-preview-"));
  writeFileSync(join(projectDir, "server.js"), server("v1"));
  preview = startPreview({ projectDir, port: await freePort(), log: () => {} });

  expect(await fetchUntil(preview.url, "v1")).toBe("v1");
  writeFileSync(join(projectDir, "server.js"), server("v2"));
  expect(await fetchUntil(preview.url, "v2")).toBe("v2");
}, 20_000);

test("stop ends the project and is safe to call twice", async () => {
  projectDir = mkdtempSync(join(tmpdir(), "aha-preview-"));
  writeFileSync(join(projectDir, "server.js"), server("up"));
  preview = startPreview({ projectDir, port: await freePort(), log: () => {} });
  expect(await fetchUntil(preview.url, "up")).toBe("up");
  await preview.stop();
  await preview.stop();
  await expect(fetch(preview.url)).rejects.toThrow();
}, 20_000);
