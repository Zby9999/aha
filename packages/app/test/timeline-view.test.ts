import { createTimeline } from "@aha/contracts";
import { expect, test } from "vitest";
import { toViewItems } from "../ui/timelineView.ts";

test("agent message deltas stream into one message that the final message replaces", () => {
  const t = createTimeline({ sessionId: "s" });
  t.append({ kind: "agent_message_delta", source: "agent-host", messageId: "m1", delta: "Your projects " });
  t.append({ kind: "agent_message_delta", source: "agent-host", messageId: "m1", delta: "are only" });
  expect(toViewItems(t.entries())).toEqual([{ type: "agent_message", key: "s:0", text: "Your projects are only", streaming: true }]);

  t.append({ kind: "agent_message", source: "agent-host", messageId: "m1", text: "Your projects are only kept in memory." });
  expect(toViewItems(t.entries())).toEqual([{ type: "agent_message", key: "s:0", text: "Your projects are only kept in memory.", streaming: false }]);
});

test("a tool call shows as running until its result arrives", () => {
  const t = createTimeline({ sessionId: "s" });
  t.append({ kind: "tool_call", source: "agent-host", toolCallId: "c1", toolName: "read", args: { path: "server.js" } });
  expect(toViewItems(t.entries())[0]).toMatchObject({ type: "tool", state: "running" });
  t.append({ kind: "tool_result", source: "agent-host", toolCallId: "c1", toolName: "read", output: "const x = 1;", isError: true });
  expect(toViewItems(t.entries())).toEqual([
    { type: "tool", key: "s:0", toolName: "read", args: { path: "server.js" }, state: "error", output: "const x = 1;" },
  ]);
});
