import { createTimeline } from "@aha/contracts";
import { expect, test } from "vitest";
import { composerPlaceholder, conversationItems, sessionView, toViewItems } from "../ui/timelineView.ts";

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

test("real tool activity and the reply share the pending turn's display key", () => {
  const timeline = createTimeline({ sessionId: "s" });
  const request = timeline.append({ kind: "user_message", source: "agent-host", text: "Check the project." });
  const key = `${request.id}:reply`;
  expect(conversationItems(timeline.entries(), true)[1]).toMatchObject({ key, pending: true, parts: [] });

  timeline.append({ kind: "tool_call", source: "agent-host", toolCallId: "read-1", toolName: "read", args: { path: "server.js" } });
  expect(conversationItems(timeline.entries(), true)[1]).toMatchObject({ key, pending: true, parts: [{ state: "running" }] });
  expect(conversationItems(timeline.entries(), false)[1]).toMatchObject({ key, pending: false, parts: [{ state: "running" }] });

  timeline.append({ kind: "tool_result", source: "agent-host", toolCallId: "read-1", toolName: "read", output: "Read complete", isError: false });
  timeline.append({ kind: "agent_message_delta", source: "agent-host", messageId: "reply", delta: "Checked" });
  timeline.append({ kind: "agent_message", source: "agent-host", messageId: "reply", text: "Checked the project." });
  const items = conversationItems(timeline.entries(), true);
  expect(items).toHaveLength(2);
  expect(items[1]).toMatchObject({ key, parts: [{ state: "completed" }, { text: "Checked the project." }] });
});

test("Pi's preamble, tool results, edit and final response stay in order in the same reply", () => {
  const timeline = createTimeline({ sessionId: "s" });
  const request = timeline.append({ kind: "user_message", source: "agent-host", text: "Check the project." });
  timeline.append({ kind: "agent_message", source: "agent-host", messageId: "intro", text: "I'll check the handler." });
  timeline.append({ kind: "tool_call", source: "agent-host", toolCallId: "edit-1", toolName: "edit", args: { path: "server.js" } });
  timeline.append({ kind: "tool_result", source: "agent-host", toolCallId: "edit-1", toolName: "edit", output: "Done", isError: false });
  const edit = timeline.append({ kind: "file_edit", source: "agent-host", path: "server.js", change: "modify", toolCallId: "edit-1" });
  const parts = [{ text: "I'll check the handler." }, { state: "completed" }, { entry: edit }];
  expect(conversationItems(timeline.entries(), true)[1]).toMatchObject({ key: request.id + ":reply", parts });

  timeline.append({ kind: "agent_message", source: "agent-host", messageId: "final", text: "Fixed the handler." });
  const next = timeline.append({ kind: "user_message", source: "agent-host", text: "And the tests?" });
  const items = conversationItems(timeline.entries(), true);
  expect(items).toHaveLength(4);
  expect(items[1]).toMatchObject({ key: request.id + ":reply", pending: false, parts: [...parts, { text: "Fixed the handler." }] });
  expect(items[3]).toMatchObject({ key: next.id + ":reply", pending: true, parts: [] });
});

test("a detected Impasse without an Offer does not interrupt the conversation", () => {
  const t = createTimeline({ sessionId: "s" });
  t.append({ kind: "impasse", source: "decisions", impasse: {
    id: "detected", trigger: "detected", title: "Repeated error", conceptIds: [], sourceEntryIds: [],
  } });
  const question = t.append({ kind: "impasse", source: "app", impasse: {
    id: "asked", trigger: "ask_why", title: "A direct question", conceptIds: [], sourceEntryIds: [],
  } });
  expect(toViewItems(t.entries())).toEqual([{ type: "entry", key: question.id, entry: question }]);
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
  t.append({ kind: "lesson_card", source: "teaching", lessonId: "l1", step: "explain", card: { root: "r", elements: {} } });
  expect(sessionView(t.entries()).canRetry(error)).toBe(true);
  t.append({ kind: "lesson_answer_recovered", source: "app", lessonId: "l1", cardEntryId: probe.id });
  expect(sessionView(t.entries()).canRetry(error)).toBe(false);
});

test("the composer says what a message will do in each Mode", () => {
  const t = createTimeline({ sessionId: "s" });
  expect(composerPlaceholder(sessionView(t.entries()), false)).toBe("Message your agent…");
  expect(composerPlaceholder(sessionView(t.entries()), true)).toBe("What do you want to understand?");
  const impasse = { id: "impasse-1", trigger: "why" as const, title: "Why: the change to server.js", conceptIds: [], sourceEntryIds: [] };
  t.append({ kind: "impasse", source: "app", impasse });
  t.append({ kind: "mode_change", source: "app", mode: "learning", impasseId: "impasse-1" });
  // Live, Enter did nothing while the Lesson was starting, and nothing said why.
  expect(composerPlaceholder(sessionView(t.entries()), false)).toMatch(/Preparing the Lesson/);
  t.append({ kind: "lesson_start", source: "teaching", lessonId: "lesson-1", impasseId: "impasse-1" });
  // A work request typed here becomes a Lesson question; say that the agent does not get it.
  expect(composerPlaceholder(sessionView(t.entries()), false)).toMatch(/Back to work/);
});
