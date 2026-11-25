import { join } from "node:path";
import { createBackend, type Backend } from "@aha/app";
import { currentMode, isKind, type Concept, type Evidence, type LearnerContext, type Teaching } from "@aha/contracts";
import { expect, test } from "vitest";
import { buildModules } from "../src/modules.ts";

const projectDir = join(import.meta.dirname, "../../../examples/portfolio");
const concept: Concept = {
  id: "session-tokens",
  name: "Session tokens",
  mastery: "seen_explanation",
  evidence: [],
  relatedFiles: [],
  userEdited: false,
};

async function setup(customize: (teaching: Teaching) => Teaching) {
  const modules = buildModules({ agentHost: "stub", background: "stub", decisions: "stub", learnerModel: "stub", teaching: "stub" });
  const evidence: Evidence[] = [];
  const errors: unknown[] = [];
  const abandonments: string[] = [];
  const contexts: Array<LearnerContext | null> = [];
  const backend = await createBackend({
    projectDir,
    sessionId: "lesson-exit",
    onLearningError: (error) => errors.push(error),
    modules: {
      ...modules,
      agentHost: {
        async startSession(options) {
          const session = await modules.agentHost.startSession(options);
          return { ...session, setLearnerContext: (context) => contexts.push(context) };
        },
      },
      decisions: { ...modules.decisions, selectConcepts: async () => [concept.id] },
      learnerModel: (options) => ({
        ...modules.learnerModel(options),
        readConcepts: async () => [concept],
        appendEvidence: async (item) => { evidence.push(item); },
      }),
      teaching(options) {
        const teaching = modules.teaching(options);
        const adapted = customize({
          ...teaching,
          startLesson: (input) => teaching.startLesson({ ...input, impasse: { ...input.impasse, conceptIds: [concept.id] } }),
        });
        return { ...adapted, abandon: (id) => { abandonments.push(id); return adapted.abandon(id); } };
      },
    },
  });
  return { backend, entries: () => backend.timeline.entries(), evidence, errors, abandonments, contexts };
}

function pausedCall() {
  let signalEntered!: () => void;
  let resume!: () => void;
  const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
  const finish = new Promise<void>((resolve) => { resume = resolve; });
  return {
    entered,
    resume,
    async pause() {
      signalEntered();
      await finish;
    },
  };
}

async function exitBeforeModelReturns(backend: Backend) {
  const exit = backend.dispatch({ type: "back_to_work" });
  expect(currentMode(backend.timeline.entries())).toBe("work");
  const nextTurn = new Promise((resolve) => setImmediate(() => resolve("still waiting")));
  await expect(Promise.race([exit.then(() => "exited"), nextTurn])).resolves.toBe("exited");
  await backend.dispatch({ type: "send_message", text: "Carry on" });
  expect(backend.timeline.entries().findLast((entry) => entry.kind === "user_message")?.text).toBe("Carry on");
}

async function submitLatestCard(backend: Backend) {
  const card = backend.timeline.entries().findLast((entry) => entry.kind === "lesson_card")!;
  await backend.dispatch({ type: "card_answer", lessonId: card.lessonId, cardEntryId: card.id, answer: { type: "text", text: "The token changes." } });
  return card.lessonId;
}

test("Back to work during the initial Probe leaves no published Lesson and preserves the next request", async () => {
  const model = pausedCall();
  const { backend, entries, abandonments, contexts } = await setup((teaching) => ({
    ...teaching,
    async startLesson(input) {
      const result = await teaching.startLesson(input);
      if (input.impasse.text === "First question") await model.pause();
      return result;
    },
  }));
  await backend.dispatch({ type: "ask_why", text: "First question" });
  await model.entered;
  try {
    expect(contexts.at(-1)?.concepts).toEqual([concept]);
    await exitBeforeModelReturns(backend);
    expect(contexts.at(-1)).toBeNull();
    expect(entries().filter((entry) => "lessonId" in entry)).toEqual([]);
    await backend.dispatch({ type: "ask_why", text: "Second question" });
    expect(currentMode(entries())).toBe("learning");
  } finally {
    model.resume();
  }
  await backend.settled();
  expect(entries().filter((entry) => isKind(entry, "lesson_start")).map(({ impasseId }) => impasseId)).toEqual(["impasse-2"]);
  expect(entries().filter((entry) => isKind(entry, "lesson_card")).map(({ step }) => step)).toEqual(["probe"]);
  expect(entries().filter((entry) => isKind(entry, "lesson_end"))).toEqual([]);
  expect(abandonments).toEqual(["lesson-1"]);
  expect(contexts.at(-1)?.concepts).toEqual([concept]);
  expect(currentMode(entries())).toBe("learning");
});

test.each(["explanation", "follow-up", "assessment", "error"] as const)(
  "Back to work during a delayed %s abandons once and discards the old result",
  async (operation) => {
    const model = pausedCall();
    const { backend, entries, evidence, errors, abandonments, contexts } = await setup((teaching) => ({
      ...teaching,
      async answer(input) {
        const result = await teaching.answer(input);
        const shouldPause = result.some((entry) => entry.kind === "lesson_end") ? operation === "assessment" : ["explanation", "error"].includes(operation);
        if (shouldPause) await model.pause();
        if (operation === "error") throw new Error("Late model error");
        return result;
      },
      async followUp(input) {
        const result = await teaching.followUp(input);
        await model.pause();
        return result;
      },
      async abandon(lessonId) {
        const result = await teaching.abandon(lessonId);
        // The assessment has already finished inside Teaching, but its result is still pending publication.
        return operation === "assessment" ? [] : result;
      },
    }));
    await backend.dispatch({ type: "ask_why", text: "First question" });
    await backend.settled();
    const firstLesson = entries().findLast((entry) => entry.kind === "lesson_start")!;
    if (operation === "follow-up") {
      await backend.dispatch({ type: "send_message", text: "Can you explain this?" });
    } else {
      await submitLatestCard(backend);
      if (operation === "assessment") {
        await backend.settled();
        await submitLatestCard(backend);
      }
    }
    await model.entered;
    const before = entries().length;
    try {
      await exitBeforeModelReturns(backend);
      await backend.dispatch({ type: "back_to_work" });
      expect(contexts.at(-1)).toBeNull();
      await backend.dispatch({ type: "ask_why", text: "Second question" });
    } finally {
      model.resume();
    }
    await backend.settled();
    const oldLessonDuringExit = entries().slice(before).filter((entry) => "lessonId" in entry && entry.lessonId === firstLesson.lessonId);
    expect(oldLessonDuringExit).toMatchObject([{ kind: "lesson_end", outcome: "abandoned" }]);
    expect(abandonments).toEqual([firstLesson.lessonId]);
    expect(evidence).toEqual([]);
    expect(errors).toEqual([]);
    expect(contexts.at(-1)?.concepts).toEqual([concept]);
    expect(currentMode(entries())).toBe("learning");
    if (operation === "assessment") {
      const activeContext = contexts.at(-1);
      backend.timeline.append({ kind: "lesson_end", source: "teaching", lessonId: firstLesson.lessonId, outcome: "completed" });
      await backend.settled();
      expect(evidence).toEqual([]);
      expect(contexts.at(-1)).toBe(activeContext);
      expect(currentMode(entries())).toBe("learning");
    }
  },
);

test("Back to work at publication preserves an already committed completion and its Evidence", async () => {
  const { backend, entries, evidence, abandonments } = await setup((teaching) => teaching);
  await backend.dispatch({ type: "ask_why", text: "Why?" });
  await backend.settled();
  const lessonId = await submitLatestCard(backend);
  await backend.settled();
  let exit: Promise<void> | undefined;
  const unsubscribe = backend.timeline.subscribe((entry) => {
    if (entry.kind === "lesson_end") exit = backend.dispatch({ type: "back_to_work" });
  });
  await submitLatestCard(backend);
  await backend.settled();
  unsubscribe();
  expect(exit).toBeDefined();
  await exit;
  expect(entries().filter((entry) => isKind(entry, "lesson_end"))).toMatchObject([{ lessonId, outcome: "completed" }]);
  expect(abandonments).toEqual([]);
  expect(evidence.map(({ type }) => type)).toEqual(["probe_result", "articulation"]);
  expect(currentMode(entries())).toBe("work");
});

test("a failed Lesson start clears its Learner Context and returns to work", async () => {
  const { backend, entries, contexts, errors } = await setup((teaching) => ({
    ...teaching,
    async startLesson() { throw new Error("Lesson start failed"); },
  }));
  await backend.dispatch({ type: "ask_why", text: "Why?" });
  await backend.settled();
  expect(contexts).toEqual([{ concepts: [concept] }, null]);
  expect(currentMode(entries())).toBe("work");
  expect(entries().filter((entry) => isKind(entry, "lesson_start"))).toEqual([]);
  expect(entries().findLast((entry) => entry.kind === "error")).toMatchObject({
    source: "app", message: "Couldn't prepare this Lesson. Try Why again.",
  });
  expect(errors).toHaveLength(1);
});

test("a failed follow-up is visible and leaves the current Lesson open", async () => {
  const { backend, entries, evidence } = await setup((teaching) => ({
    ...teaching,
    async followUp() { throw new Error("Expected provider failure"); },
  }));
  await backend.dispatch({ type: "ask_why", text: "Why?" });
  await backend.settled();
  await backend.dispatch({ type: "send_message", text: "Why this line?" });
  await backend.settled();
  expect(entries().findLast((entry) => entry.kind === "error")).toMatchObject({
    source: "app", message: "Couldn't answer that question. Ask again or go back to work.",
  });
  expect(currentMode(entries())).toBe("learning");
  expect(evidence).toEqual([]);
});

test.each(["accept", "skip"] as const)("a user cannot %s an Impasse without a persisted Offer", async (response) => {
  const { backend, entries } = await setup((teaching) => teaching);
  const impasseId = "no-offer";
  backend.timeline.append({ kind: "impasse", source: "decisions", impasse: { id: impasseId, trigger: "why", title: "Why?", conceptIds: [], sourceEntryIds: [] } });
  await backend.settled();
  await expect(backend.dispatch({ type: "offer_response", impasseId, response })).rejects.toThrow(/no offer/i);
  expect(entries().filter((entry) => isKind(entry, "offer_response"))).toEqual([]);
  expect(currentMode(entries())).toBe("work");
});
