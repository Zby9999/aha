import { join } from "node:path";
import { createBackend } from "@aha/app";
import { isKind, type AhaModules, type BackgroundRunRequest, type Concept } from "@aha/contracts";
import { DEMO_CONCEPTS } from "@aha/contracts/fixtures";
import { expect, test } from "vitest";
import { buildModules } from "../src/modules.ts";

// Seam: the backend with real Teaching and a fake model. Live (W5), "Which one should I fix first?" sent with Ask why
// right after a Lesson started a new Probe and was never answered (#97).

const projectDir = join(import.meta.dirname, "../../../examples/portfolio");
const token: Concept = {
  id: DEMO_CONCEPTS.sessionToken, name: "Session tokens", mastery: "not_encountered", evidence: [], relatedFiles: ["public/app.js", "server.js"], userEdited: false,
};
const citations = [{ path: "server.js", startLine: 19, endLine: 21 }];
const probe = { question: "What happens to the token on refresh?", citations };
const explanation = { component: "TextExplanation", props: { title: "Two separate causes", text: "Refresh makes a new token; restart empties sessions.", citations } };
const order = { component: "TextExplanation", props: { title: "Fix the token first", text: "Keep the token first, because every request depends on it.", citations } };

async function afterOneLesson(between?: "work message") {
  const trace: BackgroundRunRequest[] = [];
  const base = buildModules({ agentHost: "stub", background: "real", decisions: "stub", learnerModel: "stub", teaching: "real" });
  const modules: AhaModules = {
    ...base,
    background: { async run(request) {
      trace.push(request);
      const draft = request.prompt.includes('"question":"..."') ? probe
        : request.prompt.includes("Assess the actual Articulation") ? { result: "correct", credits: [{ conceptId: token.id, answerQuote: "a new token" }], citations }
          : request.prompt.includes("Which one should I fix first?") ? order : explanation;
      return { text: JSON.stringify(draft), filesWritten: [] };
    } },
    decisions: { ...base.decisions, async selectConcepts() { return [token.id]; } },
    learnerModel(options) {
      return { ...base.learnerModel(options), async readConcepts(ids) { return ids.includes(token.id) ? [token] : []; }, async appendEvidence() {} };
    },
  };
  const backend = await createBackend({ projectDir, sessionId: "follow-up", modules });
  await backend.dispatch({ type: "ask_why", text: "My projects disappear on refresh and on restart. Why?" });
  await backend.settled();
  for (const [step, text] of [["probe", "It is one bug."], ["articulate", "Refresh makes a new token and restart empties memory."]] as const) {
    const card = backend.timeline.entries().filter((entry) => isKind(entry, "lesson_card")).findLast((entry) => entry.step === step)!;
    await backend.dispatch({ type: "card_answer", lessonId: card.lessonId, cardEntryId: card.id, answer: { type: "text", text } });
    await backend.settled();
  }
  const firstEnd = backend.timeline.entries().findLast((entry) => isKind(entry, "lesson_end"))!;
  expect(firstEnd).toMatchObject({ outcome: "completed" });
  if (between) {
    await backend.dispatch({ type: "send_message", text: "Please add a footer." });
    await backend.settled();
  }
  const seen = trace.length;
  await backend.dispatch({ type: "ask_why", text: "Which one should I fix first?" });
  await backend.settled();
  const entries = backend.timeline.entries();
  const impasse = entries.findLast((entry) => isKind(entry, "impasse"))!;
  const secondLesson = entries.findLast((entry) => isKind(entry, "lesson_start"))!;
  const cards = entries.filter((entry) => isKind(entry, "lesson_card")).filter((entry) => entry.lessonId === secondLesson.lessonId);
  await backend.stop();
  return { firstEnd, impasse, cards, entries, prompts: trace.slice(seen).map(({ prompt }) => prompt) };
}

test("Ask why right after a Lesson is answered directly as its follow-up, without a new Probe", async () => {
  const { firstEnd, impasse, cards, entries, prompts } = await afterOneLesson();
  expect(impasse.impasse.sourceEntryIds).toEqual([firstEnd.id]);
  expect(cards.map(({ step }) => step)).toEqual(["explain"]);
  expect(cards[0]!.card.elements.card?.props).toMatchObject({ title: "Fix the token first" });
  expect(entries.at(-2)).toMatchObject({ kind: "lesson_end", outcome: "completed" });
  expect(prompts).toHaveLength(1);
  const context = JSON.parse(prompts[0]!.split("Lesson context (JSON):\n")[1]!);
  expect(context.discussion).toMatchObject({
    directQuestion: "Which one should I fix first?",
    previousLesson: { question: "My projects disappear on refresh and on restart. Why?", explanations: [expect.stringContaining("Refresh makes a new token")] },
  });
  expect(prompts[0]).toContain("give it and the reason");
});

test("Ask why after work has resumed starts a Lesson as before", async () => {
  const { impasse, cards } = await afterOneLesson("work message");
  expect(impasse.impasse.sourceEntryIds).toEqual([]);
  expect(cards.map(({ step }) => step)).toEqual(["probe"]);
});
