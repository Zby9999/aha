import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTimeline, type BackgroundRunRequest, type Concept, type LessonInput, type NewTimelineEntry } from "@aha/contracts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTeaching } from "../src/index.ts";

// Seam: Teaching with a fake background model. These check what the model is asked, for cases found in the live
// evaluation (docs/evaluation/learning-scenarios.md).

const source = "const PORT = process.env.PORT || 3000;\napp.listen(PORT);\n";
const citations = [{ path: "server.js", startLine: 1, endLine: 2 }];
const probe = { question: "Which port will the app listen on?", citations };
const text = { component: "TextExplanation", props: { title: "PORT comes first", text: "The environment value wins.", citations } };

let projectDir: string;
beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "aha-prompts-"));
  await writeFile(join(projectDir, "server.js"), source);
});
afterEach(() => rm(projectDir, { recursive: true, force: true }));

async function startLesson(question = "Why does server.js read process.env.PORT?", concepts: Concept[] = []) {
  const timeline = createTimeline({ sessionId: "prompts" });
  const run = vi.fn(async (request: BackgroundRunRequest) => ({ text: JSON.stringify(request.prompt.includes('"question":"..."') ? probe : text), filesWritten: [] }));
  const teaching = createTeaching({
    background: { run },
    decisions: { async checkGrounding() { return { grounded: true, missingFiles: [], reason: "ok" }; }, async chooseComponent() { return "TextExplanation"; } },
  });
  const input: LessonInput = {
    impasse: { id: "i", trigger: "ask_why", title: question, text: question, sourceEntryIds: [], conceptIds: [] },
    learner: { concepts },
    project: { projectDir, files: ["server.js"] },
    timeline: timeline.entries(),
  };
  const append = (entries: NewTimelineEntry[]) => entries.map((entry) => timeline.append(entry));
  const card = append(await teaching.startLesson(input)).find((entry) => entry.kind === "lesson_card")!;
  if (card.kind !== "lesson_card") throw new Error("expected a Probe card");
  const answer = async (answerText: string) => {
    const submitted = { type: "text", text: answerText } as const;
    timeline.append({ kind: "card_answer", source: "app", lessonId: card.lessonId, cardEntryId: card.id, step: "probe", answer: submitted });
    return append(await teaching.answer({ lessonId: card.lessonId, cardEntryId: card.id, answer: submitted, timeline: timeline.entries() }));
  };
  return { teaching, timeline, run, card, answer, lastPrompt: () => run.mock.lastCall![0].prompt };
}

test("a question asked before the Probe is answered must not give the Probe's answer away", async () => {
  const { teaching, timeline, card, lastPrompt } = await startLesson();
  await teaching.followUp({ lessonId: card.lessonId, question: "Also limit the title to 80 characters.", timeline: timeline.entries() });
  expect(lastPrompt()).toContain("has not answered the prediction question (discussion.probe) yet");
  expect(lastPrompt()).toContain("don't explain the code that decides it");
});

test("every generated card is asked for in the learner's own language", async () => {
  // Live, a Chinese question got an English Probe and a Chinese explanation.
  const { run, answer } = await startLesson("为什么 server.js 里要写 process.env.PORT || 3000？");
  await answer("我不知道");
  expect(run.mock.calls.length).toBeGreaterThan(1);
  for (const [request] of run.mock.calls) expect(request.systemPrompt).toContain("same language the user writes in");
});

test("after \"I don't know\" the lesson neither judges a prediction nor asks about one", async () => {
  // Live: "Your prediction is not quite right" answered "I don't know", then "what caused the behavior you predicted?".
  const { answer, lastPrompt } = await startLesson();
  const entries = await answer("I don't know");
  expect(lastPrompt()).toContain("If the user did not make a prediction");
  const articulation = entries.find((entry) => entry.kind === "lesson_card" && entry.step === "articulate")!;
  const props = articulation.kind === "lesson_card" ? articulation.card.elements[articulation.card.root]!.props : {};
  expect(props).toMatchObject({ prompt: "In your own words, what causes this behavior?" });
});

test("a brief Lesson after \"I don't know\" does not judge a prediction either", async () => {
  const seen: Concept = { id: "env", name: "Environment variables", mastery: "seen_explanation", evidence: [], relatedFiles: [], userEdited: false };
  const { answer, lastPrompt } = await startLesson(undefined, [seen]);
  await answer("I don't know");
  expect(lastPrompt()).toContain("one or two sentences");
  expect(lastPrompt()).toContain("If the user did not make a prediction");
});

test("an Offer for a repeated question is not titled as an error", async () => {
  // Live, a user's repeated "my projects are gone again??" was offered as "Understand this error".
  const { teaching } = await startLesson();
  const offer = await teaching.offer({
    impasse: { id: "d", trigger: "detected", title: "A similar issue has come up again: my projects are gone again??", sourceEntryIds: ["a", "b"], conceptIds: [] },
    learner: { concepts: [] },
  });
  expect(offer!.elements[offer!.root]!.props).toMatchObject({ title: "This has come up before. Look at why?" });
});

test("a Probe on a change that keeps the behaviour the same asks about the mechanism", async () => {
  // Live, "store the password hashed" got "what happens when you log in?", whose answer "it works" tests nothing.
  const { run } = await startLesson();
  expect(run.mock.calls[0]![0].prompt).toContain("If the change keeps the visible behaviour the same");
});

test("an Ask why on a mastered Concept is answered, and only a Why? on a change gets a hint", async () => {
  // Live, "Why does the stored password need a salt?" got a hint card that left the answer out.
  const hinted: Concept = { id: "env", name: "Environment variables", mastery: "correct_with_hints", evidence: [], relatedFiles: ["server.js"], userEdited: false };
  const asked = await startLesson("Why does server.js read process.env.PORT?", [hinted]);
  expect(asked.card).toMatchObject({ step: "explain" });
  expect(asked.lastPrompt()).toContain("Answer the question the user actually asked");
  expect(asked.lastPrompt()).not.toContain("Leave the conclusion to the user");

  const timeline = createTimeline({ sessionId: "why-hint" });
  const edit = timeline.append({ kind: "file_edit", source: "agent-host", path: "server.js", change: "modify", diff: "@@ -1,2 +1,2 @@\n+const PORT = process.env.PORT || 3000;" });
  const run = vi.fn(async (_request: BackgroundRunRequest) => ({ text: JSON.stringify(text), filesWritten: [] }));
  const teaching = createTeaching({
    background: { run },
    decisions: { async checkGrounding() { return { grounded: true, missingFiles: [], reason: "ok" }; }, async chooseComponent() { return "TextExplanation"; } },
  });
  await teaching.startLesson({
    impasse: { id: "w", trigger: "why", title: "Why: Edited server.js", sourceEntryIds: [edit.id], conceptIds: [] },
    learner: { concepts: [hinted] }, project: { projectDir, files: ["server.js"] }, timeline: timeline.entries(),
  });
  expect(run.mock.lastCall![0].prompt).toContain("Leave the conclusion to the user");
});

test("a follow-up is answered even when the code cannot show the answer", async () => {
  // Live, "Is localStorage safe? Could another website read my token?" got the fix explained again.
  const { teaching, timeline, card, answer, lastPrompt } = await startLesson();
  await answer("It uses PORT when it is set.");
  await teaching.followUp({ lessonId: card.lessonId, question: "Is it safe to put secrets in environment variables?", timeline: timeline.entries() });
  expect(lastPrompt()).toContain("even when it goes beyond what the code shows");
});

function backgroundTeaching(drafts: object[]) {
  const grounding: unknown[] = [];
  const run = vi.fn(async (_request: BackgroundRunRequest) => ({ text: JSON.stringify(drafts.length > 1 ? drafts.shift() : drafts[0]), filesWritten: [] }));
  const teaching = createTeaching({
    background: { run },
    decisions: {
      async checkGrounding(input) { grounding.push(input.explanation); return { grounded: true, missingFiles: [], reason: "ok" }; },
      async chooseComponent() { return "TextExplanation"; },
    },
  });
  return { teaching, run, grounding };
}
const independent: Concept = { id: "env", name: "Environment variables", mastery: "explains_independently", evidence: [], relatedFiles: ["server.js"], userEdited: false };
const withBackground = (background: string) => ({ component: "TextExplanation", props: { ...text.props, background } });

test("an answer to Ask why may add labelled general background that the grounding check skips", async () => {
  const { teaching, run, grounding } = backgroundTeaching([withBackground("Hosting platforms set PORT for each app. That is why code reads it first.")]);
  const timeline = createTimeline({ sessionId: "background" });
  const entries = await teaching.startLesson({
    impasse: { id: "q", trigger: "ask_why", title: "Why read PORT?", text: "Why read PORT?", sourceEntryIds: [], conceptIds: [] },
    learner: { concepts: [independent] }, project: { projectDir, files: ["server.js"] }, timeline: timeline.entries(),
  });
  expect(run.mock.lastCall![0].prompt).toContain("at most two sentences of it in background");
  const explain = entries.find((entry) => entry.kind === "lesson_card")!;
  expect(explain.kind === "lesson_card" && explain.card.elements.card?.props).toMatchObject({
    text: "The environment value wins.", background: "Hosting platforms set PORT for each app. That is why code reads it first.", citations,
  });
  expect(grounding).toHaveLength(1);
  expect(JSON.stringify(grounding[0])).not.toContain("Hosting platforms");
  expect(JSON.stringify(grounding[0])).toContain("The environment value wins.");
});

test("background longer than two sentences is redrafted", async () => {
  const { teaching, run } = backgroundTeaching([withBackground("One. Two. Three."), withBackground("One. Two.")]);
  const entries = await teaching.startLesson({
    impasse: { id: "q", trigger: "ask_why", title: "Why read PORT?", text: "Why read PORT?", sourceEntryIds: [], conceptIds: [] },
    learner: { concepts: [independent] }, project: { projectDir, files: ["server.js"] }, timeline: [],
  });
  expect(run.mock.calls[1]![0].prompt).toContain("Keep background to at most two sentences.");
  const explain = entries.find((entry) => entry.kind === "lesson_card")!;
  expect(explain.kind === "lesson_card" && explain.card.elements.card?.props).toMatchObject({ background: "One. Two." });
});

test("an explanation of a prediction or a Why? on a change cannot carry general background", async () => {
  const { teaching, run } = backgroundTeaching([withBackground("Hosting platforms set PORT.")]);
  const timeline = createTimeline({ sessionId: "no-background" });
  const edit = timeline.append({ kind: "file_edit", source: "agent-host", path: "server.js", change: "modify", diff: "@@ -1,2 +1,2 @@\n+const PORT = process.env.PORT || 3000;" });
  const entries = await teaching.startLesson({
    impasse: { id: "w", trigger: "why", title: "Why: Edited server.js", sourceEntryIds: [edit.id], conceptIds: [] },
    learner: { concepts: [independent] }, project: { projectDir, files: ["server.js"] }, timeline: timeline.entries(),
  });
  expect(run.mock.lastCall![0].prompt).not.toContain("background");
  const explain = entries.find((entry) => entry.kind === "lesson_card")!;
  expect(explain.kind === "lesson_card" && explain.card.elements.card?.props).not.toHaveProperty("background");
});
