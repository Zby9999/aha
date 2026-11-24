import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTimeline, type TimelineEntry } from "@aha/contracts";
import { afterEach, expect, test } from "vitest";
import { createPiAgentHost } from "../src/index.ts";

// Contract test on a real recording (#24): the demo script run through the user's own Pi 1.5.2 with
// ollama-cloud/deepseek-v4.1-flash (scripts/record-demo.ts, curated by scripts/curate-recording.ts).
// Replaying the recorded Pi stream turn by turn must give exactly the Timeline the live session produced.

const recorded = join(import.meta.dirname, "fixtures/recorded");
const FAKE_PI = join(import.meta.dirname, "fake-pi.mjs");
let projectDir: string | undefined;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

const payload = ({ id, sessionId, seq, at, version, ...rest }: TimelineEntry) => rest;

test("the recorded demo session replays to the Timeline it produced live", async () => {
  const live = JSON.parse(readFileSync(join(recorded, "demo.timeline.json"), "utf8")) as TimelineEntry[];
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "aha-recorded-")));
  cpSync(join(import.meta.dirname, "../../../examples/portfolio"), projectDir, { recursive: true, filter: (src) => !src.includes("node_modules") });

  const timeline = createTimeline({ sessionId: "replay" });
  const host = createPiAgentHost({
    command: process.execPath,
    args: [FAKE_PI],
    env: { ...process.env, FAKE_PI_EVENTS: join(recorded, "demo.rpc.jsonl"), FAKE_PI_SPLIT: "turns" },
  });
  const session = await host.startSession({ projectDir, timeline });
  try {
    const messages = live.filter((e) => e.kind === "user_message");
    for (const [i, message] of messages.entries()) {
      await session.sendUserMessage(message.text);
      // The run ends with its last agent_message, just before the next user message (or the end).
      const next = live.findIndex((e, j) => j > live.indexOf(message) && e.kind === "user_message");
      const turnEnd = next === -1 ? live.length : next;
      for (const until = Date.now() + 5000; timeline.entries().length < turnEnd && Date.now() < until; ) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(timeline.entries().length, `turn ${i + 1}`).toBe(turnEnd);
    }
  } finally {
    await session.stop();
  }

  expect(timeline.entries().map(payload)).toEqual(live.map(payload));
}, 30_000);

test("the recording covers the demo's moments", () => {
  const live = JSON.parse(readFileSync(join(recorded, "demo.timeline.json"), "utf8")) as TimelineEntry[];
  const edits = live.filter((e) => e.kind === "file_edit").map((e) => (e as { path: string }).path);
  // Turn 1: the partial fix in the page; turn 2: projects by user on the server; turn 3: server-made token, both files.
  expect(edits).toEqual(["public/app.js", "server.js", "server.js", "public/app.js"]);
  expect(live.filter((e) => e.kind === "user_message")).toHaveLength(3);
  expect(live.some((e) => e.kind === "error" && e.origin === "tool")).toBe(true);
});
