import { join } from "node:path";
import { createBackend } from "@aha/app";
import { isKind, type AhaModules, type BackgroundRunRequest, type Concept, type Evidence } from "@aha/contracts";
import { DEMO_CONCEPTS } from "@aha/contracts/fixtures";
import { expect, test, vi } from "vitest";
import { buildModules } from "../src/modules.ts";

const projectDir = join(import.meta.dirname, "../../../examples/portfolio");
const token: Concept = {
  id: DEMO_CONCEPTS.sessionToken,
  name: "Session tokens",
  mastery: "not_encountered",
  evidence: [],
  relatedFiles: ["public/app.js", "server.js"],
  userEdited: false,
};
const citations = [
  { path: "public/app.js", startLine: 2 },
  { path: "server.js", startLine: 19, endLine: 21 },
  { path: "server.js", startLine: 38, endLine: 42 },
];
const knownAnswer = "Refresh creates a new token and the server has no session for it.";
const wrongAnswer = "Refresh keeps the same token so the user stays logged in.";
const result = (value: string, answerQuote: string, conceptId = token.id) => ({ result: value, credits: [{ conceptId, answerQuote }], citations });
const feedback = "Refresh runs app.js again, so it makes a new token that the server has never seen.";
const scenarios = [
  { label: "correct", answer: knownAnswer, draft: result("correct", "the server has no session for it"), outcome: "positive", strength: "moderate" },
  { label: "partial", answer: "Refresh creates a new token.", draft: result("partial", "Refresh creates a new token"), outcome: "positive", strength: "weak" },
  // Live (W5), an answer that left out one cause ended with only "Lesson complete" (#94).
  { label: "partial with feedback", answer: "Refresh creates a new token.", draft: { ...result("partial", "Refresh creates a new token"), feedback }, outcome: "positive", strength: "weak", feedback: "Almost: one part is missing" },
  { label: "incorrect", answer: wrongAnswer, draft: { ...result("incorrect", "Refresh keeps the same token"), feedback }, outcome: "negative", strength: "moderate", feedback: "Not quite" },
  { label: "incorrect without feedback", answer: wrongAnswer, draft: result("incorrect", "Refresh keeps the same token"), outcome: "negative", strength: "moderate" },
  { label: "unclear", answer: "I don't know, I'm still confused.", draft: { ...result("unclear", "still confused"), feedback }, feedback: "Let's make it clearer" },
  { label: "unquoted", answer: knownAnswer, draft: result("correct", "not expressed by learner") },
  { label: "unrelated concept", answer: knownAnswer, draft: result("correct", "creates a new token", "unrelated") },
  { label: "out of range", answer: knownAnswer, draft: { ...result("correct", "creates a new token"), citations: [{ path: "server.js", startLine: 44 }] } },
  { label: "no selected concept", answer: knownAnswer, draft: result("correct", "creates a new token"), noConcept: true },
  { label: "malformed", answer: knownAnswer, draft: "not JSON" },
  { label: "model unavailable", answer: knownAnswer, draft: null },
] as const;

test.each(scenarios)("generated Articulation with $label evaluation completes and writes only supported Evidence", async (scenario) => {
  const base = buildModules({ agentHost: "stub", background: "real", decisions: "stub", learnerModel: "stub", teaching: "real" });
  const trace: BackgroundRunRequest[] = [];
  const evidence: Evidence[] = [];
  const modules: AhaModules = {
    ...base,
    background: { async run(request) {
      trace.push(request);
      if (trace.length === 3 && scenario.draft === null) throw new Error("Expected model failure");
      const draft = [
        { question: "What happens to the token on refresh?", citations },
        { component: "TextExplanation", props: { title: "Refresh creates a token", text: "The new token has no session.", citations } },
        scenario.draft,
        { component: "TextExplanation", props: { title: "Another way", text: "Each page load runs line 2 again.", citations } },
      ][trace.length - 1];
      return { text: typeof draft === "string" ? draft : JSON.stringify(draft), filesWritten: [] };
    } },
    decisions: {
      ...base.decisions,
      async selectConcepts() { return "noConcept" in scenario ? [] : [token.id]; },
    },
    learnerModel(options) {
      return {
        ...base.learnerModel(options),
        async readConcepts(ids) { return ids.includes(token.id) ? [token] : []; },
        async appendEvidence(entry) { evidence.push(entry); },
      };
    },
  };
  const backend = await createBackend({ projectDir, sessionId: "assessment", modules });
  try {
    await backend.dispatch({ type: "ask_why", text: "Why does public/app.js get logged out on refresh?" });
    await backend.settled();
    const submit = async (step: "probe" | "articulate", text: string) => {
      const entry = backend.timeline.entries().filter((value) => isKind(value, "lesson_card")).find((value) => value.step === step)!;
      await backend.dispatch({ type: "card_answer", lessonId: entry.lessonId, cardEntryId: entry.id, answer: { type: "text", text } });
      await backend.settled();
      return entry;
    };
    await submit("probe", "It keeps the same token.");
    expect(evidence).toEqual([]);
    const articulation = await submit("articulate", scenario.answer);
    expect(articulation.card.elements[articulation.card.root]?.props).toMatchObject({ citations });
    if ("feedback" in scenario) {
      // Live, a wrong or confused Articulation ended the Lesson with only "Completed" (P1-1, P1-2).
      const card = backend.timeline.entries().findLast((value) => isKind(value, "lesson_card"))!;
      expect(card).toMatchObject({ step: "explain" });
      expect(card.card.elements[card.card.root]?.props).toMatchObject({ title: scenario.feedback, text: feedback, citations });
      expect(backend.timeline.entries().some((entry) => entry.kind === "lesson_end")).toBe(false);
      await backend.dispatch({ type: "send_message", text: "Can you explain it another way?" });
      await backend.settled();
      expect(trace[3]!.prompt).toContain(scenario.answer);
      expect(trace[3]!.prompt).toContain(feedback);
      expect(backend.timeline.entries().findLast((value) => isKind(value, "lesson_card"))!.card.elements.card?.props).toMatchObject({ title: "Another way" });
      expect(evidence).toEqual([]);
      await backend.dispatch({ type: "back_to_work" });
      await backend.settled();
    }
    const entries = backend.timeline.entries();
    expect(entries.findLast((entry) => entry.kind === "lesson_end")).toMatchObject({ outcome: "completed" });
    if ("noConcept" in scenario) {
      expect(trace).toHaveLength(2);
    } else {
      const request = trace[2]!;
      expect(request.tools).toEqual([]);
      expect(request.prompt).toContain(scenario.answer);
      expect(request.prompt).toContain("38: app.get");
      expect(request.prompt).not.toContain("34: sessions[token]");
      expect(request.prompt).toContain("The new token has no session.");
    }
    if ("outcome" in scenario) {
      const event = entries.find((entry) => entry.kind === "answer_assessment")!;
      const submitted = entries.findLast((entry) => entry.kind === "card_answer")!;
      expect(event).toMatchObject({ answerEntryId: submitted.id, conceptIds: [token.id], result: scenario.label.split(" ")[0] });
      expect(evidence).toMatchObject([{ conceptId: token.id, type: "articulation", entryIds: [submitted.id, event.id], outcome: scenario.outcome, strength: scenario.strength }]);
    } else {
      expect(evidence).toEqual([]);
      expect(entries.some((entry) => entry.kind === "answer_assessment")).toBe(false);
    }
  } finally {
    await backend.stop();
  }
});

async function answerWithSlowAssessment(assessmentMs: number) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const base = buildModules({ agentHost: "stub", background: "real", decisions: "stub", learnerModel: "stub", teaching: "real" });
  let calls = 0;
  const evidence: Evidence[] = [];
  const modules: AhaModules = {
    ...base,
    background: { async run({ signal }) {
      calls += 1;
      const draft = [
        { question: "What happens to the token on refresh?", citations },
        { component: "TextExplanation", props: { title: "Refresh creates a token", text: "The new token has no session.", citations } },
        result("correct", "the server has no session for it"),
      ][calls - 1];
      if (calls === 3) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, assessmentMs);
          signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); });
        });
      }
      return { text: JSON.stringify(draft), filesWritten: [] };
    } },
    decisions: { ...base.decisions, async selectConcepts() { return [token.id]; } },
    learnerModel(options) {
      return {
        ...base.learnerModel(options),
        async readConcepts(ids) { return ids.includes(token.id) ? [token] : []; },
        async appendEvidence(entry) { evidence.push(entry); },
      };
    },
  };
  const backend = await createBackend({ projectDir, sessionId: "slow-assessment", modules });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await backend.dispatch({ type: "ask_why", text: "Why does public/app.js get logged out on refresh?" });
    await backend.settled();
    const card = (step: "probe" | "articulate") => backend.timeline.entries().filter((value) => isKind(value, "lesson_card")).find((value) => value.step === step)!;
    await backend.dispatch({ type: "card_answer", lessonId: card("probe").lessonId, cardEntryId: card("probe").id, answer: { type: "text", text: "It keeps the same token." } });
    await backend.settled();
    await backend.dispatch({ type: "card_answer", lessonId: card("articulate").lessonId, cardEntryId: card("articulate").id, answer: { type: "text", text: knownAnswer } });
    await vi.advanceTimersByTimeAsync(assessmentMs);
    await backend.settled();
    return { assessment: backend.timeline.entries().find((entry) => entry.kind === "answer_assessment"), evidence, warnings: warn.mock.calls.flat() };
  } finally {
    warn.mockRestore();
    vi.useRealTimers();
    await backend.stop();
  }
}

test("a long Articulation whose assessment takes 15 s still records Evidence", async () => {
  // Live, a complete three-cause answer timed out at the old 10 s assessment deadline and earned nothing.
  const { assessment, evidence, warnings } = await answerWithSlowAssessment(15_000);
  expect(assessment).toMatchObject({ result: "correct" });
  expect(evidence).toMatchObject([{ conceptId: token.id, type: "articulation", outcome: "positive" }]);
  expect(warnings).toEqual([]);
});

test("an assessment past the deadline is reported, not dropped silently", async () => {
  const { assessment, evidence, warnings } = await answerWithSlowAssessment(31_000);
  expect(assessment).toBeUndefined();
  expect(evidence).toEqual([]);
  expect(warnings).toEqual([expect.stringMatching(/assessment took longer than 30 s; no Evidence recorded/)]);
});

test("a hint Lesson asks for a one-sentence Articulation, and a correct one is strong Evidence", async () => {
  // Live, hint Lessons recorded nothing, so Lessons alone could never lift a Concept past correct_with_hints.
  const base = buildModules({ agentHost: "stub", background: "real", decisions: "stub", learnerModel: "stub", teaching: "real" });
  const trace: BackgroundRunRequest[] = [];
  const evidence: Evidence[] = [];
  const hinted = { ...token, mastery: "correct_with_hints" as const };
  const drafts = [
    { component: "TextExplanation", props: { title: "Check the token", text: "Look at where app.js makes the token.", citations } },
    result("correct", "the server has no session for it"),
  ];
  const modules: AhaModules = {
    ...base,
    background: { async run(request) { trace.push(request); return { text: JSON.stringify(drafts[trace.length - 1]), filesWritten: [] }; } },
    decisions: { ...base.decisions, async selectConcepts() { return [token.id]; } },
    learnerModel(options) {
      return {
        ...base.learnerModel(options),
        async readConcepts(ids) { return ids.includes(token.id) ? [hinted] : []; },
        async appendEvidence(entry) { evidence.push(entry); },
      };
    },
  };
  const backend = await createBackend({ projectDir, sessionId: "hint-articulation", modules });
  try {
    const edit = backend.timeline.append({ kind: "file_edit", source: "agent-host", path: "public/app.js", change: "modify", diff: "@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;" });
    await backend.dispatch({ type: "why", entryId: edit.id });
    await backend.settled();
    const cards = () => backend.timeline.entries().filter((value) => isKind(value, "lesson_card"));
    expect(cards().map(({ step }) => step)).toEqual(["explain", "articulate"]);
    expect(trace[0]!.prompt).toContain("Leave the conclusion to the user");
    const articulation = cards()[1]!;
    expect(articulation.card.elements[articulation.card.root]?.props).toMatchObject({ prompt: "In one sentence, what causes this behavior?", citations });
    expect(backend.timeline.entries().some((entry) => entry.kind === "lesson_end")).toBe(false);
    await backend.dispatch({ type: "card_answer", lessonId: articulation.lessonId, cardEntryId: articulation.id, answer: { type: "text", text: knownAnswer } });
    await backend.settled();
    expect(backend.timeline.entries().findLast((entry) => entry.kind === "lesson_end")).toMatchObject({ outcome: "completed" });
    expect(evidence).toMatchObject([{ conceptId: token.id, type: "articulation", outcome: "positive", strength: "strong" }]);
  } finally {
    await backend.stop();
  }
});

test("an Articulation can credit two Concepts, each with its own quote, and each gets one Evidence", async () => {
  // Live, an answer that explained five Concepts correctly was credited with one.
  const base = buildModules({ agentHost: "stub", background: "real", decisions: "stub", learnerModel: "stub", teaching: "real" });
  const reload: Concept = { ...token, id: DEMO_CONCEPTS.pageReload, name: "Page reload" };
  const storage: Concept = { ...token, id: "browser-storage", name: "Browser storage" };
  const trace: BackgroundRunRequest[] = [];
  const evidence: Evidence[] = [];
  const answer = "A refresh runs app.js again and the new token has no session on the server.";
  const drafts = [
    { question: "What happens to the token on refresh?", citations },
    { component: "TextExplanation", props: { title: "Refresh creates a token", text: "The new token has no session.", citations } },
    { result: "correct", citations, credits: [
      { conceptId: reload.id, answerQuote: "A refresh runs app.js again" },
      { conceptId: token.id, answerQuote: "the new token has no session" },
      { conceptId: storage.id, answerQuote: "on the server" },
    ] },
  ];
  const modules: AhaModules = {
    ...base,
    background: { async run(request) { trace.push(request); return { text: JSON.stringify(drafts[trace.length - 1]), filesWritten: [] }; } },
    decisions: { ...base.decisions, async selectConcepts() { return [token.id, reload.id, storage.id]; } },
    learnerModel(options) {
      return {
        ...base.learnerModel(options),
        async readConcepts(ids) { return [token, reload, storage].filter(({ id }) => ids.includes(id)); },
        async appendEvidence(entry) { evidence.push(entry); },
      };
    },
  };
  const backend = await createBackend({ projectDir, sessionId: "two-credits", modules });
  try {
    await backend.dispatch({ type: "ask_why", text: "Why does public/app.js get logged out on refresh?" });
    await backend.settled();
    for (const [step, text] of [["probe", "I don't know."], ["articulate", answer]] as const) {
      const entry = backend.timeline.entries().filter((value) => isKind(value, "lesson_card")).find((value) => value.step === step)!;
      await backend.dispatch({ type: "card_answer", lessonId: entry.lessonId, cardEntryId: entry.id, answer: { type: "text", text } });
      await backend.settled();
    }
    expect(trace[2]!.prompt).toContain("Credit at most two listed Concepts");
    const event = backend.timeline.entries().find((entry) => entry.kind === "answer_assessment")!;
    expect(event).toMatchObject({ result: "correct", conceptIds: [reload.id, token.id] });
    expect(evidence.map(({ conceptId, type, outcome }) => [conceptId, type, outcome])).toEqual([
      [reload.id, "articulation", "positive"], [token.id, "articulation", "positive"],
    ]);
  } finally {
    await backend.stop();
  }
});
