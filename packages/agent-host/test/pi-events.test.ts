import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTimeline, type AgentSession, type Timeline, type TimelineEntry } from "@aha/contracts";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createPiAgentHost } from "../src/index.ts";

// Contract tests. Seam: AgentHost / AgentSession. A fake Pi replays a Pi RPC event stream (test/fixtures/*.rpc.jsonl,
// in Pi 1.5.2's wire format) after each prompt; we check the Timeline the agent host writes from it.

const FAKE_PI = join(import.meta.dirname, "fake-pi.mjs");
const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

let projectDir: string;
let log: string;
let timeline: Timeline;
let session: AgentSession | undefined;

beforeEach(() => {
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "aha-pi-events-")));
  mkdirSync(join(projectDir, "public"));
  writeFileSync(join(projectDir, "public/app.js"), "const sessionToken = Math.random().toString(36).slice(2);\n");
  log = join(projectDir, "..", `${projectDir.split("/").pop()}.log`);
  timeline = createTimeline({ sessionId: "s" });
});

afterEach(async () => {
  await session?.stop();
  session = undefined;
});

async function replay(events: string, until: (entries: readonly TimelineEntry[]) => boolean) {
  const host = createPiAgentHost({
    command: process.execPath,
    args: [FAKE_PI],
    env: { ...process.env, FAKE_PI_EVENTS: fixture(events), FAKE_PI_LOG: log },
  });
  session = await host.startSession({ projectDir, timeline });
  await session.sendUserMessage("Fix my login");
  const deadline = Date.now() + 3000;
  while (!until(timeline.entries())) {
    if (Date.now() > deadline) throw new Error(`timed out; got ${timeline.entries().map((e) => e.kind).join(", ")}`);
    await new Promise((r) => setTimeout(r, 10));
  }
  return timeline.entries().map(({ id, sessionId, seq, at, version, ...rest }) => rest);
}

const fromAgentHost = (entry: object) => ({ source: "agent-host", ...entry });

test("a recorded fix-the-login run becomes the expected Timeline", async () => {
  const entries = await replay("fix-login.rpc.jsonl", (e) => e.some((x) => x.kind === "agent_message" && x.text.startsWith("Done.")));
  const patch = readFileSync(fixture("fix-login.rpc.jsonl"), "utf8").match(/"patch":("(?:[^"\\]|\\.)*")/)![1]!;

  expect(entries).toEqual(
    [
      { kind: "user_message", text: "Fix my login" },
      { kind: "agent_message_delta", messageId: "pi-msg-1", delta: "Let me look " },
      { kind: "agent_message_delta", messageId: "pi-msg-1", delta: "at your code." },
      { kind: "agent_message", messageId: "pi-msg-1", text: "Let me look at your code." },
      { kind: "tool_call", toolCallId: "call-1", toolName: "read", args: { path: "public/app.js" } },
      { kind: "tool_result", toolCallId: "call-1", toolName: "read", output: "const sessionToken = Math.random().toString(36).slice(2);", isError: false },
      { kind: "agent_message_delta", messageId: "pi-msg-2", delta: "Your page makes a new session token on every load. I'll keep it in localStorage." },
      { kind: "agent_message", messageId: "pi-msg-2", text: "Your page makes a new session token on every load. I'll keep it in localStorage." },
      { kind: "tool_call", toolCallId: "call-2", toolName: "edit", args: expect.objectContaining({ path: "public/app.js" }) },
      { kind: "tool_result", toolCallId: "call-2", toolName: "edit", output: "Successfully replaced 1 block(s) in public/app.js.", isError: false },
      { kind: "file_edit", path: "public/app.js", change: "modify", toolCallId: "call-2", diff: JSON.parse(patch) },
      { kind: "tool_call", toolCallId: "call-3", toolName: "write", args: { path: "public/token.js", content: "export {}" } },
      { kind: "tool_result", toolCallId: "call-3", toolName: "write", output: "Successfully wrote to public/token.js", isError: false },
      { kind: "file_edit", path: "public/token.js", change: "create", toolCallId: "call-3" },
      { kind: "tool_call", toolCallId: "call-4", toolName: "bash", args: { command: "npm test" } },
      { kind: "tool_result", toolCallId: "call-4", toolName: "bash", output: 'npm ERR! Missing script: "test"\n\nCommand exited with code 1', isError: true },
      { kind: "error", origin: "tool", toolCallId: "call-4", message: 'npm ERR! Missing script: "test"\n\nCommand exited with code 1' },
      { kind: "unknown_agent_event", agentEventType: "compaction_start", raw: { type: "compaction_start", reason: "threshold" } },
      { kind: "unknown_agent_event", agentEventType: "extension_ui_request", raw: expect.objectContaining({ method: "confirm", id: "ui-1" }) },
      { kind: "agent_message_delta", messageId: "pi-msg-3", delta: "Done. Refresh the page: " },
      { kind: "agent_message_delta", messageId: "pi-msg-3", delta: "you should stay logged in." },
      { kind: "agent_message", messageId: "pi-msg-3", text: "Done. Refresh the page: you should stay logged in." },
    ].map(fromAgentHost),
  );
});

test("each streamed reply's deltas add up to its final text", async () => {
  const entries = await replay("fix-login.rpc.jsonl", (e) => e.some((x) => x.kind === "agent_message" && x.text.startsWith("Done.")));
  for (const message of entries.filter((e) => e.kind === "agent_message")) {
    const deltas = entries.filter((e) => e.kind === "agent_message_delta" && e.messageId === message.messageId);
    expect(deltas.map((d) => (d as { delta: string }).delta).join("")).toBe(message.text);
  }
});

test("an extension dialog is cancelled so Pi does not wait for an answer Aha cannot give", async () => {
  await replay("fix-login.rpc.jsonl", (e) => e.some((x) => x.kind === "agent_message" && x.text.startsWith("Done.")));
  const sent = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(sent).toContainEqual({ type: "extension_ui_response", id: "ui-1", cancelled: true });
});

test("model, retry and extension failures become agent errors; a failed login says how to log in again", async () => {
  const entries = await replay("model-errors.rpc.jsonl", (e) => e.filter((x) => x.kind === "error").length === 3);
  expect(entries.filter((e) => e.kind !== "user_message")).toEqual(
    [
      { kind: "error", origin: "agent", message: expect.stringMatching(/^The model request failed: 401.*pi auth login/s) },
      { kind: "unknown_agent_event", agentEventType: "auto_retry_start", raw: expect.objectContaining({ attempt: 1 }) },
      { kind: "error", origin: "agent", message: "The model request failed after retrying: 529 overloaded" },
      { kind: "error", origin: "agent", message: "A Pi extension failed (tool_call): boom" },
    ].map(fromAgentHost),
  );
});
