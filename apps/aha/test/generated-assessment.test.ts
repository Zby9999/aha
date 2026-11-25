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
const result = (value: string, answerQuote: string) => ({ result: value, conceptId: token.id, answerQuote, citations });
const scenarios = [
  { label: "correct", answer: knownAnswer, draft: result("correct", "the server has no session for it"), outcome: "positive", strength: "moderate" },
  { label: "partial", answer: "Refresh creates a new token.", draft: result("partial", "Refresh creates a new token"), outcome: "positive", strength: "weak" },
  { label: "incorrect", answer: wrongAnswer, draft: result("incorrect", "Refresh keeps the same token"), outcome: "negative", strength: "moderate" },
  { label: "unclear", answer: "I understand.", draft: result("unclear", "I understand") },
  { label: "unquoted", answer: knownAnswer, draft: result("correct", "not expressed by learner") },
  { label: "unrelated concept", answer: knownAnswer, draft: { ...result("correct", "creates a new token"), conceptId: "unrelated" } },
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
      expect(event).toMatchObject({ answerEntryId: submitted.id, conceptIds: [token.id], result: scenario.label });
      expect(evidence).toMatchObject([{ conceptId: token.id, type: "articulation", entryIds: [submitted.id, event.id], outcome: scenario.outcome, strength: scenario.strength }]);
    } else {
      expect(evidence).toEqual([]);
      expect(entries.some((entry) => entry.kind === "answer_assessment")).toBe(false);
    }
  } finally {
    await backend.stop();
  }
});

test("a long Articulation whose assessment takes 15 s still records Evidence", async () => {
  // Live, a complete three-cause answer timed out at the old 10 s assessment deadline and earned nothing.
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
          const timer = setTimeout(resolve, 15_000);
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
  try {
    await backend.dispatch({ type: "ask_why", text: "Why does public/app.js get logged out on refresh?" });
    await backend.settled();
    const card = (step: "probe" | "articulate") => backend.timeline.entries().filter((value) => isKind(value, "lesson_card")).find((value) => value.step === step)!;
    await backend.dispatch({ type: "card_answer", lessonId: card("probe").lessonId, cardEntryId: card("probe").id, answer: { type: "text", text: "It keeps the same token." } });
    await backend.settled();
    await backend.dispatch({ type: "card_answer", lessonId: card("articulate").lessonId, cardEntryId: card("articulate").id, answer: { type: "text", text: knownAnswer } });
    await vi.advanceTimersByTimeAsync(15_000);
    await backend.settled();
    expect(backend.timeline.entries().find((entry) => entry.kind === "answer_assessment")).toMatchObject({ result: "correct" });
    expect(evidence).toMatchObject([{ conceptId: token.id, type: "articulation", outcome: "positive" }]);
  } finally {
    vi.useRealTimers();
    await backend.stop();
  }
});
