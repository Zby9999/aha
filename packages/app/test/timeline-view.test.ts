import { createTimeline } from "@aha/contracts";
import { expect, test } from "vitest";
import { sessionView, toViewItems } from "../ui/timelineView.ts";

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

test("in learning mode Why, Ask why and Offers are off and only the running Lesson's cards can be used", () => {
  const t = createTimeline({ sessionId: "s" });
  const impasse = (id: string) => ({ id, trigger: "detected" as const, title: `Gap ${id}`, conceptIds: [], sourceEntryIds: [] });
  t.append({ kind: "impasse", source: "decisions", impasse: impasse("i1") });
  const offer1 = t.append({ kind: "offer", source: "teaching", impasseId: "i1", card: { root: "r", elements: {} } });
  t.append({ kind: "impasse", source: "decisions", impasse: impasse("i2") });
  const offer2 = t.append({ kind: "offer", source: "teaching", impasseId: "i2", card: { root: "r", elements: {} } });
  expect(sessionView(t.entries())).toMatchObject({ mode: "work", canStartLesson: true });
  expect(sessionView(t.entries()).isDone(offer2)).toBe(false);

  t.append({ kind: "offer_response", source: "app", impasseId: "i1", response: "accept" });
  t.append({ kind: "mode_change", source: "app", mode: "learning", impasseId: "i1" });
  t.append({ kind: "lesson_start", source: "teaching", lessonId: "l1", impasseId: "i1" });
  const probe = t.append({ kind: "lesson_card", source: "teaching", lessonId: "l1", step: "probe", card: { root: "r", elements: {} } });
  const learning = sessionView(t.entries());
  expect(learning).toMatchObject({ mode: "learning", canStartLesson: false, lessonTitle: "Gap i1" });
  expect(learning.isDone(offer1)).toBe(true);
  expect(learning.isDone(offer2)).toBe(true);
  expect(learning.isDone(probe)).toBe(false);

  t.append({ kind: "lesson_end", source: "teaching", lessonId: "l1", outcome: "abandoned" });
  t.append({ kind: "mode_change", source: "app", mode: "work", impasseId: "i1" });
  const work = sessionView(t.entries());
  expect(work).toMatchObject({ mode: "work", canStartLesson: true });
  expect(work.isDone(offer2)).toBe(false);
  expect(work.isDone(probe)).toBe(true);
  expect(toViewItems(t.entries()).some((i) => i.type === "entry" && i.entry.kind === "mode_change")).toBe(false);
});

test("a failed answer offers Retry until teaching moves the Lesson on", () => {
  const t = createTimeline({ sessionId: "s" });
  t.append({ kind: "mode_change", source: "app", mode: "learning", impasseId: "i1" });
  t.append({ kind: "lesson_start", source: "teaching", lessonId: "l1", impasseId: "i1" });
  const probe = t.append({ kind: "lesson_card", source: "teaching", lessonId: "l1", step: "probe", card: { root: "r", elements: {} } });
  t.append({ kind: "card_answer", source: "app", lessonId: "l1", cardEntryId: probe.id, step: "probe", answer: { type: "text", text: "x" } });
  const error = t.append({ kind: "lesson_error", source: "app", lessonId: "l1", cardEntryId: probe.id, message: "Couldn't prepare the next step." });
  expect(sessionView(t.entries()).canRetry(error)).toBe(true);
  t.append({ kind: "answer_assessment", source: "teaching", lessonId: "l1", answerEntryId: probe.id, step: "probe", conceptIds: [], result: "correct" });
  expect(sessionView(t.entries()).canRetry(error)).toBe(false);
});
