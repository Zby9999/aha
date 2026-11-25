import { join } from "node:path";
import { createTimeline, type LessonInput, type MasteryLevel } from "@aha/contracts";
import { DEMO_CONCEPTS, DEMO_PROJECT_FILES } from "@aha/contracts/fixtures";
import { expect, test } from "vitest";
import { createFixtureTeaching, createTeaching } from "../src/lesson.ts";

const projectDir = join(import.meta.dirname, "../../../examples/portfolio");

function fixture(mastery: MasteryLevel, trigger: LessonInput["impasse"]["trigger"] = "detected") {
  const conceptId = DEMO_CONCEPTS.sessionToken;
  const timeline = createTimeline({ sessionId: "mastery" });
  const edit = timeline.append({
    kind: "file_edit", source: "agent-host", path: "public/app.js", change: "modify",
    diff: "@@ -1,2 +1,2 @@\n // A random id for this visitor. The server uses it to remember who is logged in.",
  });
  const impasse: LessonInput["impasse"] = {
    id: "token", trigger, title: "Why does GET /api/me 401 recur after refresh?", conceptIds: [conceptId], sourceEntryIds: [edit.id],
  };
  const input: LessonInput = {
    impasse, learner: { concepts: [{ id: conceptId, name: "Session token", mastery, evidence: [], relatedFiles: ["public/app.js"], userEdited: false }] },
    project: { projectDir, files: [...DEMO_PROJECT_FILES] }, timeline: timeline.entries(),
  };
  const teaching = createFixtureTeaching({ background: { async run() { throw new Error("Fixtures do not use a model"); } }, decisions: {
    async chooseComponent() { return "TextExplanation"; },
    async checkGrounding() { return { grounded: true, missingFiles: [], reason: "Test dependency" }; },
  } });
  return { input, teaching, timeline };
}

test.each([
  ["not_encountered", ["probe"]],
  ["seen_explanation", ["probe"]],
  ["correct_with_hints", ["explain"]],
  ["catches_agent_mistakes", ["articulate"]],
] as const)("starts the intended path for %s", async (mastery, startsWith) => {
  const { input, teaching } = fixture(mastery);
  const offer = await teaching.offer(input);
  expect(offer?.elements[offer.root]?.type).toBe("OfferCard");
  const started = await teaching.startLesson(input);
  expect(started.filter((entry) => entry.kind === "lesson_card").map((entry) => entry.step)).toEqual(startsWith);
  if (mastery === "correct_with_hints") {
    expect(started.at(-1)).toMatchObject({ kind: "lesson_end", outcome: "completed" });
    expect(started.some((entry) => entry.kind === "answer_assessment")).toBe(false);
  }
  if (mastery === "catches_agent_mistakes") {
    expect(started.find((entry) => entry.kind === "lesson_card")).toMatchObject({
      card: { elements: { card: { props: { citations: [{ path: "public/app.js", startLine: 1 }] } } } },
    });
  }
});

test("an automatic Offer is suppressed for an independent learner but explicit help still responds", async () => {
  const { input, teaching } = fixture("explains_independently");
  await expect(teaching.offer(input)).resolves.toBeNull();
  for (const trigger of ["why", "ask_why"] as const) {
    const entries = await teaching.startLesson({ ...input, impasse: { ...input.impasse, trigger } });
    expect(entries.map(({ kind }) => kind)).toEqual(["lesson_start", "lesson_card", "lesson_end"]);
    expect(entries[1]).toMatchObject({ step: "explain" });
  }
});

test("a learner who has seen the concept gets feedback without a repeated Articulation", async () => {
  const { input, teaching, timeline } = fixture("seen_explanation");
  const started = (await teaching.startLesson(input)).map((entry) => timeline.append(entry));
  const probe = started.find((entry) => entry.kind === "lesson_card")!;
  const answer = { type: "choice", optionId: "new" } as const;
  timeline.append({ kind: "card_answer", source: "app", lessonId: probe.lessonId, cardEntryId: probe.id, step: "probe", answer });
  const next = await teaching.answer({ lessonId: probe.lessonId, cardEntryId: probe.id, answer, timeline: timeline.entries() });
  expect(next.filter((entry) => entry.kind === "lesson_card").map((entry) => entry.step)).toEqual(["explain"]);
  expect(next.at(-1)).toMatchObject({ kind: "lesson_end", outcome: "completed" });
});

test("an explicitly relevant concept with unknown mastery keeps the full Lesson available", async () => {
  const { input, teaching } = fixture("explains_independently");
  const mixed = { ...input, impasse: { ...input.impasse, conceptIds: [...input.impasse.conceptIds, "unseen"] } };
  await expect(teaching.offer(mixed)).resolves.not.toBeNull();
  await expect(teaching.startLesson(mixed)).resolves.toContainEqual(expect.objectContaining({ kind: "lesson_card", step: "probe" }));
});

test("a review does not target an unrelated earlier edit", async () => {
  const { input, teaching, timeline } = fixture("catches_agent_mistakes");
  timeline.append({ kind: "file_edit", source: "agent-host", path: "server.js", change: "modify" });
  const entries = await teaching.startLesson({
    ...input, impasse: { ...input.impasse, title: "Why has public/app.js refreshed?", sourceEntryIds: [] },
    timeline: timeline.entries().slice(1),
  });
  expect(entries).toContainEqual(expect.objectContaining({ kind: "lesson_card", step: "explain" }));
  expect(entries).not.toContainEqual(expect.objectContaining({ kind: "lesson_card", step: "articulate" }));
});

test("a non-portfolio hint uses the related file even without a recorded edit", async () => {
  const { input, teaching } = fixture("correct_with_hints");
  const concept = { ...input.learner.concepts[0]!, id: "network-request", relatedFiles: ["server.js"] };
  const entries = await teaching.startLesson({
    ...input, impasse: { ...input.impasse, title: "Why does the request return 401?", conceptIds: [concept.id], sourceEntryIds: [] },
    learner: { concepts: [concept] }, timeline: [],
  });
  expect(entries).toContainEqual(expect.objectContaining({
    kind: "lesson_card", step: "explain", card: { root: "card", elements: { card: expect.objectContaining({
      props: expect.objectContaining({ citations: [expect.objectContaining({ path: "server.js" })] }),
    }) } },
  }));
  expect(entries.at(-1)).toMatchObject({ kind: "lesson_end", outcome: "completed" });
});

test("a fixture with no readable code completes with guidance and no fabricated citation", async () => {
  const { input, teaching } = fixture("correct_with_hints");
  const entries = await teaching.startLesson({ ...input, project: { ...input.project, files: [] } });
  const explanation = entries.find((entry) => entry.kind === "lesson_card");
  expect(explanation?.card.elements.card?.props).toMatchObject({
    text: expect.stringContaining("select Why"), citations: [],
  });
  expect(entries.at(-1)).toMatchObject({ kind: "lesson_end", outcome: "completed" });
});

test("a generated short Lesson retries a diagram draft as text", async () => {
  const { input, timeline } = fixture("seen_explanation");
  const citations = [{ path: "public/app.js", startLine: 2 }];
  const output = [
    { question: "What happens to the token?", citations },
    { component: "DataFlowDiagram", props: { title: "A long draft" } },
    { component: "TextExplanation", props: { title: "Refresh creates a token", text: "The token is created again.", citations } },
  ];
  const teaching = createTeaching({ background: { async run() { return { text: JSON.stringify(output.shift()), filesWritten: [] }; } }, decisions: {
    async chooseComponent() { return "TextExplanation"; },
    async checkGrounding() { return { grounded: true, missingFiles: [], reason: "Test dependency" }; },
  } });
  const started = (await teaching.startLesson(input)).map((entry) => timeline.append(entry));
  const probe = started.find((entry) => entry.kind === "lesson_card")!;
  const answer = { type: "text", text: "The token changes." } as const;
  timeline.append({ kind: "card_answer", source: "app", lessonId: probe.lessonId, cardEntryId: probe.id, step: "probe", answer });
  const entries = await teaching.answer({ lessonId: probe.lessonId, cardEntryId: probe.id, answer, timeline: timeline.entries() });
  const cards = entries.filter((entry) => entry.kind === "lesson_card");
  expect(cards).toHaveLength(1);
  expect(cards[0]?.card.elements.card?.type).toBe("TextExplanation");
  expect(entries.at(-1)).toMatchObject({ kind: "lesson_end", outcome: "completed" });
});

test("a generated Probe cannot cite only an unrelated existing file", async () => {
  const { input } = fixture("not_encountered");
  const teaching = createTeaching({
    background: { async run() {
      const text = JSON.stringify({ question: "Which framework is installed?", citations: [{ path: "server.js", startLine: 3 }] });
      return { text, filesWritten: [] };
    } },
    decisions: { async chooseComponent() { return "TextExplanation"; }, async checkGrounding() {
      return { grounded: true, missingFiles: [], reason: "Test dependency" };
    } },
  });
  await expect(teaching.startLesson(input)).rejects.toThrow(/relevant source citation/);
});

test("a direct generated answer also retries when it only cites an unrelated file", async () => {
  const { input } = fixture("explains_independently", "why");
  const drafts = [
    { title: "The server uses Express", text: "Express sets up routing.", citations: [{ path: "server.js", startLine: 3 }] },
    { title: "A fresh token", text: "The browser creates a token each time the script runs.", citations: [{ path: "public/app.js", startLine: 2 }] },
  ];
  const teaching = createTeaching({
    background: { async run() {
      return { text: JSON.stringify({ component: "TextExplanation", props: drafts.shift() }), filesWritten: [] };
    } },
    decisions: { async chooseComponent() { return "TextExplanation"; }, async checkGrounding() {
      return { grounded: true, missingFiles: [], reason: "Test dependency" };
    } },
  });
  const entries = await teaching.startLesson(input);
  const explain = entries.find((entry) => entry.kind === "lesson_card");
  expect(explain?.card.elements.card?.props).toMatchObject({
    title: "A fresh token", citations: [{ path: "public/app.js", startLine: 2 }],
  });
});

test("Concepts picked by the read gate adapt to the ones the learner has met", async () => {
  const { input, teaching } = fixture("correct_with_hints");
  const unseen = { ...input.learner.concepts[0]!, id: "authentication", name: "Authentication", mastery: "not_encountered" as const };
  const picked = { ...input, impasse: { ...input.impasse, conceptIds: [] }, learner: { concepts: [...input.learner.concepts, unseen] } };
  const offer = await teaching.offer(picked);
  expect(offer?.elements[offer.root]?.props).toMatchObject({ title: "Want a hint?" });
  const started = await teaching.startLesson(picked);
  expect(started.filter((entry) => entry.kind === "lesson_card").map((entry) => entry.step)).toEqual(["explain"]);

  const nothingMet = { ...picked, learner: { concepts: [unseen] } };
  expect((await teaching.startLesson(nothingMet)).filter((entry) => entry.kind === "lesson_card").map((entry) => entry.step)).toEqual(["probe"]);
});
