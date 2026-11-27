import { createTimeline } from "@aha/contracts";
import { expect, test } from "vitest";
import { cardGist, chatEntries, composerPlaceholder, conversationItems, lessonProgress, replyCardIds, replyParts, sessionView, toViewItems } from "../ui/timelineView.ts";

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
    { type: "tool", key: "s:0", toolCallId: "c1", toolName: "read", args: { path: "server.js" }, state: "error", output: "const x = 1;" },
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

test("work and the running Lesson are separate conversations", () => {
  const t = createTimeline({ sessionId: "s" });
  t.append({ kind: "user_message", source: "agent-host", text: "Fix the login." });
  const impasse = { id: "i1", trigger: "ask_why" as const, title: "Why tokens?", text: "Why tokens?", conceptIds: [], sourceEntryIds: [] };
  t.append({ kind: "impasse", source: "app", impasse });
  t.append({ kind: "mode_change", source: "app", mode: "learning", impasseId: "i1" });
  t.append({ kind: "lesson_start", source: "teaching", lessonId: "l1", impasseId: "i1" });
  t.append({ kind: "agent_message", source: "agent-host", messageId: "m1", text: "Still working." });
  t.append({ kind: "lesson_question", source: "app", lessonId: "l1", text: "What is a token?" });
  const kinds = (entries: ReturnType<typeof chatEntries>) => entries.map((entry) => entry.kind);
  expect(kinds(chatEntries(t.entries()))).toEqual(["impasse", "lesson_start", "lesson_question"]);

  t.append({ kind: "lesson_end", source: "teaching", lessonId: "l1", outcome: "completed" });
  t.append({ kind: "mode_change", source: "app", mode: "work", impasseId: "i1" });
  expect(kinds(chatEntries(t.entries()))).toEqual([
    "user_message", "impasse", "mode_change", "lesson_start", "agent_message", "lesson_end", "mode_change",
  ]);
  // Review shows the past Lesson's own conversation again, without the agent's work.
  expect(kinds(chatEntries(t.entries(), "l1"))).toEqual(["impasse", "lesson_start", "lesson_question", "lesson_end"]);
});

test("answers given on a Lesson card stay on the card, not in the Lesson conversation", () => {
  const t = createTimeline({ sessionId: "s" });
  const card = { root: "r", elements: { r: { type: "ProbeCard", props: {} } } } as never;
  const impasse = { id: "i1", trigger: "ask_why" as const, title: "Why tokens?", text: "Why tokens?", conceptIds: [], sourceEntryIds: [] };
  t.append({ kind: "impasse", source: "app", impasse });
  t.append({ kind: "mode_change", source: "app", mode: "learning", impasseId: "i1" });
  t.append({ kind: "lesson_start", source: "teaching", lessonId: "l1", impasseId: "i1" });
  const probe = t.append({ kind: "lesson_card", source: "teaching", lessonId: "l1", step: "probe", card });
  t.append({ kind: "card_answer", source: "app", lessonId: "l1", cardEntryId: probe.id, step: "probe", answer: { type: "text", text: "It changes." } });
  t.append({ kind: "lesson_question", source: "app", lessonId: "l1", text: "Why does the server need it?" });
  const articulate = t.append({ kind: "lesson_card", source: "teaching", lessonId: "l1", step: "articulate", card });
  t.append({ kind: "card_answer", source: "app", lessonId: "l1", cardEntryId: articulate.id, step: "articulate", answer: { type: "text", text: "Because." } });
  const kinds = (entries: ReturnType<typeof chatEntries>) => entries.map((entry) => entry.kind);
  expect(kinds(chatEntries(t.entries()))).toEqual(["impasse", "lesson_start", "lesson_card", "lesson_question", "lesson_card"]);

  t.append({ kind: "lesson_end", source: "teaching", lessonId: "l1", outcome: "completed" });
  t.append({ kind: "mode_change", source: "app", mode: "work", impasseId: "i1" });
  expect(kinds(chatEntries(t.entries(), "l1"))).toEqual(["impasse", "lesson_start", "lesson_card", "lesson_question", "lesson_card", "lesson_end"]);
});

test("a reply gathers each run of tool calls into one group of steps, with each tool's error on its step", () => {
  const t = createTimeline({ sessionId: "s" });
  t.append({ kind: "tool_call", source: "agent-host", toolCallId: "a", toolName: "read", args: { path: "server.js" } });
  t.append({ kind: "tool_result", source: "agent-host", toolCallId: "a", toolName: "read", output: "ok", isError: false });
  t.append({ kind: "tool_call", source: "agent-host", toolCallId: "b", toolName: "bash", args: { command: "npm test" } });
  t.append({ kind: "tool_result", source: "agent-host", toolCallId: "b", toolName: "bash", output: "", isError: true });
  t.append({ kind: "error", source: "agent-host", origin: "tool", message: "npm test failed", toolCallId: "b" });
  t.append({ kind: "agent_message", source: "agent-host", messageId: "m", text: "Fixed." });
  t.append({ kind: "tool_call", source: "agent-host", toolCallId: "c", toolName: "read", args: { path: "app.js" } });
  const parts = replyParts(toViewItems(t.entries()));
  expect(parts.map((part) => part.type)).toEqual(["steps", "agent_message", "steps"]);
  expect(parts[0]).toMatchObject({ steps: [{ toolCallId: "a" }, { toolCallId: "b", state: "error", error: "npm test failed" }] });
});

test("the Lesson shows teaching at work whenever the learner's last move is newer than teaching's last card", () => {
  const t = createTimeline({ sessionId: "s" });
  const card = { root: "r", elements: { r: { type: "ProbeCard", props: {} } } } as never;
  t.append({ kind: "mode_change", source: "app", mode: "learning", impasseId: "i" });
  expect(lessonProgress(t.entries())).toBe("Preparing the lesson");
  t.append({ kind: "lesson_start", source: "teaching", lessonId: "l", impasseId: "i" });
  expect(lessonProgress(t.entries())).toBe("Preparing the lesson");
  const probe = t.append({ kind: "lesson_card", source: "teaching", lessonId: "l", step: "probe", card });
  expect(lessonProgress(t.entries())).toBeUndefined();
  t.append({ kind: "card_answer", source: "app", lessonId: "l", cardEntryId: probe.id, step: "probe", answer: { type: "text", text: "?" } });
  expect(lessonProgress(t.entries())).toBe("Preparing the explanation");
  t.append({ kind: "lesson_card", source: "teaching", lessonId: "l", step: "explain", card });
  const articulate = t.append({ kind: "lesson_card", source: "teaching", lessonId: "l", step: "articulate", card });
  t.append({ kind: "lesson_question", source: "app", lessonId: "l", text: "Why?" });
  expect(lessonProgress(t.entries())).toBe("Answering your question");
  t.append({ kind: "lesson_card", source: "teaching", lessonId: "l", step: "explain", card });
  expect(lessonProgress(t.entries())).toBeUndefined();
  t.append({ kind: "card_answer", source: "app", lessonId: "l", cardEntryId: articulate.id, step: "articulate", answer: { type: "text", text: "Because." } });
  expect(lessonProgress(t.entries())).toBe("Checking your answer");
});

test("only cards that reply to the conversation appear there: the Lesson's first card and each follow-up's answer", () => {
  const t = createTimeline({ sessionId: "s" });
  const card = (type: string, props: Record<string, unknown>) => ({ root: "r", elements: { r: { type, props } } }) as never;
  const impasse = { id: "i1", trigger: "ask_why" as const, title: "Why?", text: "Why do my projects disappear?", conceptIds: [], sourceEntryIds: [] };
  t.append({ kind: "impasse", source: "app", impasse });
  t.append({ kind: "mode_change", source: "app", mode: "learning", impasseId: "i1" });
  t.append({ kind: "lesson_start", source: "teaching", lessonId: "l1", impasseId: "i1" });
  const probe = t.append({ kind: "lesson_card", source: "teaching", lessonId: "l1", step: "probe", card: card("ProbeCard", { question: "Same cause?" }) });
  t.append({ kind: "card_answer", source: "app", lessonId: "l1", cardEntryId: probe.id, step: "probe", answer: { type: "text", text: "Yes." } });
  const explain = t.append({ kind: "lesson_card", source: "teaching", lessonId: "l1", step: "explain", card: card("TextExplanation", { title: "Two causes", text: "x" }) });
  t.append({ kind: "lesson_question", source: "app", lessonId: "l1", text: "Which one should I fix first?" });
  const answer = t.append({ kind: "lesson_card", source: "teaching", lessonId: "l1", step: "explain", card: card("TextExplanation", { title: "Storage first", text: "x" }) });

  expect(replyCardIds(t.entries())).toEqual(new Set([probe.id, answer.id]));
  const shown = chatEntries(t.entries()).filter((entry) => entry.kind === "lesson_card").map((entry) => entry.id);
  expect(shown).toEqual([probe.id, answer.id]);
  expect(shown).not.toContain(explain.id);
});

test("a reply sums up its card: a Probe's question, or an explanation's title and first two sentences", () => {
  const card = (type: string, props: Record<string, unknown>) => ({ root: "r", elements: { r: { type, props } } });
  expect(cardGist(card("ProbeCard", { question: "Same cause, or different causes?" }))).toEqual({ kind: "question", text: "Same cause, or different causes?" });
  expect(cardGist(card("TextExplanation", { title: "Storage first", text: "Fix storage first. It loses projects on restart. The token is separate." })))
    .toEqual({ kind: "explanation", title: "Storage first", text: "Fix storage first. It loses projects on restart. …" });
  expect(cardGist(card("Flowchart", { title: "What decides the screen", steps: ["a"] }))).toEqual({ kind: "explanation", title: "What decides the screen" });
});
