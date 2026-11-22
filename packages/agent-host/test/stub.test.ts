import { createTimeline } from "@aha/contracts";
import { demoSession } from "@aha/contracts/fixtures";
import { expect, test } from "vitest";
import { createStubAgentHost } from "../src/index.ts";

test("the stub agent streams each scripted reply word by word, then sends it whole", async () => {
  const timeline = createTimeline({ sessionId: "s" });
  const session = await createStubAgentHost({ script: demoSession, streamDelayMs: 1 }).startSession({ projectDir: "/p", timeline });
  const first = demoSession.find((e) => e.kind === "user_message")!;
  await session.sendUserMessage(first.kind === "user_message" ? first.text : "");

  const reply = timeline.entries().find((e) => e.kind === "agent_message")!;
  const deltas = timeline.entries().filter((e) => e.kind === "agent_message_delta" && e.messageId === (reply as { messageId: string }).messageId);
  expect(deltas.length).toBeGreaterThan(5);
  expect(deltas.map((d) => (d as { delta: string }).delta).join("")).toBe((reply as { text: string }).text);
  expect(Math.max(...deltas.map((d) => d.seq))).toBeLessThan(reply.seq);
});
