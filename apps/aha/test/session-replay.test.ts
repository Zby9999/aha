import { join } from "node:path";
import { createBackend } from "@aha/app";
import { currentMode, type AhaModules, type Evidence, type LearnerModelStore, type TimelineEntry } from "@aha/contracts";
import { DEMO_SESSION_ID, demoSession } from "@aha/contracts/fixtures";
import { describe, expect, test } from "vitest";
import { buildModules, MODULE_KEYS, readConfig, type ModuleConfig } from "../src/modules.ts";
import { replayUntilOffer } from "../src/replay.ts";

// Primary seam (spec #1): replay the demo session through the backend with Pi and Jev replaced by stubs.

const projectDir = join(import.meta.dirname, "../../../examples/portfolio");
const allStubs = Object.fromEntries(MODULE_KEYS.map((k) => [k, "stub"])) as ModuleConfig;

async function replayDemo() {
  const modules = buildModules(allStubs, { script: demoSession });
  let store: LearnerModelStore | undefined;
  const evidence: Evidence[] = [];
  const withStore: AhaModules = {
    ...modules,
    learnerModel: (o) => {
      const inner = modules.learnerModel(o);
      store = { ...inner, appendEvidence: async (e) => (evidence.push(e), inner.appendEvidence(e)) };
      return store;
    },
  };
  const backend = await createBackend({ modules: withStore, projectDir, sessionId: DEMO_SESSION_ID, onLearningError: (e) => { throw e; } });
  await replayUntilOffer(backend, demoSession);
  return { backend, store: store!, evidence, entries: () => backend.timeline.entries() };
}

const kinds = (entries: readonly TimelineEntry[]) => entries.map((e) => e.kind);
const last = <K extends TimelineEntry["kind"]>(entries: readonly TimelineEntry[], kind: K) =>
  entries.findLast((e) => e.kind === kind) as Extract<TimelineEntry, { kind: K }> | undefined;

describe("session replay with stub modules", () => {
  test("the repeated error in the demo session puts an Offer card on the Timeline", async () => {
    const { entries } = await replayDemo();
    const offer = last(entries(), "offer");
    expect(offer?.card.elements[offer.card.root]?.type).toBe("OfferCard");

    const errors = entries().filter((e) => e.kind === "error");
    expect(errors).toHaveLength(2);
    expect(offer!.seq).toBeGreaterThan(errors[1]!.seq);
    expect(kinds(entries()).filter((k) => k === "offer")).toHaveLength(1);
  });

  test("accepting the Offer walks the Lesson through Probe, Explain and Articulate back to work", async () => {
    const { backend, entries } = await replayDemo();
    const offer = last(entries(), "offer")!;
    await backend.dispatch({ type: "offer_response", impasseId: offer.impasseId, response: "accept" });
    await backend.settled();
    const probe = last(entries(), "lesson_card")!;
    expect(probe.step).toBe("probe");

    await backend.dispatch({ type: "card_answer", lessonId: probe.lessonId, cardEntryId: probe.id, answer: { type: "choice", optionId: "same" } });
    await backend.settled();
    const articulate = last(entries(), "lesson_card")!;
    expect(articulate.step).toBe("articulate");

    await backend.dispatch({ type: "card_answer", lessonId: probe.lessonId, cardEntryId: articulate.id, answer: { type: "text", text: "A refresh makes a new token." } });
    await backend.settled();

    const lesson = entries().filter((e) => "lessonId" in e && e.lessonId === probe.lessonId);
    expect(lesson.filter((e) => e.kind === "lesson_card").map((e) => (e as { step: string }).step)).toEqual(["probe", "explain", "articulate"]);
    expect(last(entries(), "lesson_end")).toMatchObject({ lessonId: probe.lessonId, outcome: "completed" });
  });

  test("an answered card cannot be submitted twice", async () => {
    const { backend, entries } = await replayDemo();
    await backend.dispatch({ type: "offer_response", impasseId: last(entries(), "offer")!.impasseId, response: "accept" });
    await backend.settled();
    const probe = last(entries(), "lesson_card")!;
    const answer = { type: "card_answer", lessonId: probe.lessonId, cardEntryId: probe.id, answer: { type: "text", text: "x" } } as const;
    await backend.dispatch(answer);
    await expect(backend.dispatch(answer)).rejects.toThrow(/already answered/);
  });

  test("skipping the Offer starts no Lesson and records no Evidence", async () => {
    const { backend, store, entries } = await replayDemo();
    const before = await store.listConcepts();
    await backend.dispatch({ type: "offer_response", impasseId: last(entries(), "offer")!.impasseId, response: "skip" });
    await backend.settled();
    expect(kinds(entries())).not.toContain("lesson_start");
    expect(await store.listConcepts()).toEqual(before);
  });

  test("a message sent with Ask why starts a Lesson and never reaches the agent", async () => {
    const { backend, entries } = await replayDemo();
    const userMessagesBefore = entries().filter((e) => e.kind === "user_message").length;
    await backend.dispatch({ type: "ask_why", text: "Why does a refresh log me out?" });
    await backend.settled();
    expect(last(entries(), "impasse")?.impasse).toMatchObject({ trigger: "ask_why", text: "Why does a refresh log me out?" });
    expect(last(entries(), "lesson_card")?.step).toBe("probe");
    expect(entries().filter((e) => e.kind === "user_message")).toHaveLength(userMessagesBefore);
  });

  test("Why on an agent change starts a Lesson directly, without an Offer", async () => {
    const { backend, entries } = await replayDemo();
    const edit = last(entries(), "file_edit")!;
    const offersBefore = entries().filter((e) => e.kind === "offer").length;
    await backend.dispatch({ type: "why", entryId: edit.id });
    await backend.settled();
    expect(last(entries(), "impasse")?.impasse).toMatchObject({ trigger: "why", sourceEntryIds: [edit.id] });
    expect(last(entries(), "lesson_card")?.step).toBe("probe");
    expect(entries().filter((e) => e.kind === "offer")).toHaveLength(offersBefore);
  });
});

describe("session Mode", () => {
  const modes = (entries: readonly TimelineEntry[]) => entries.flatMap((e) => (e.kind === "mode_change" ? [e.mode] : []));

  async function inLesson() {
    const demo = await replayDemo();
    await demo.backend.dispatch({ type: "offer_response", impasseId: last(demo.entries(), "offer")!.impasseId, response: "accept" });
    await demo.backend.settled();
    return demo;
  }

  test("starting a Lesson switches to learning mode, and completing it returns to work mode", async () => {
    const { backend, entries } = await replayDemo();
    expect(currentMode(entries())).toBe("work");
    await backend.dispatch({ type: "offer_response", impasseId: last(entries(), "offer")!.impasseId, response: "accept" });
    expect(currentMode(entries())).toBe("learning");
    await backend.settled();
    const probe = last(entries(), "lesson_card")!;
    await backend.dispatch({ type: "card_answer", lessonId: probe.lessonId, cardEntryId: probe.id, answer: { type: "text", text: "x" } });
    await backend.settled();
    const articulate = last(entries(), "lesson_card")!;
    await backend.dispatch({ type: "card_answer", lessonId: probe.lessonId, cardEntryId: articulate.id, answer: { type: "text", text: "y" } });
    await backend.settled();
    expect(modes(entries())).toEqual(["learning", "work"]);
    expect(last(entries(), "mode_change")!.seq).toBeGreaterThan(last(entries(), "lesson_end")!.seq);
  });

  test("a second Lesson cannot start while one is running, by Why, Ask why or an Offer", async () => {
    const { backend, entries } = await inLesson();
    const edit = last(entries(), "file_edit")!;
    await expect(backend.dispatch({ type: "why", entryId: edit.id })).rejects.toThrow(/already running/);
    await expect(backend.dispatch({ type: "ask_why", text: "And this?" })).rejects.toThrow(/already running/);
    await expect(backend.dispatch({ type: "offer_response", impasseId: "impasse-9", response: "accept" })).rejects.toThrow(/already running/);
    await backend.settled();
    expect(entries().filter((e) => e.kind === "lesson_start")).toHaveLength(1);
    expect(entries().filter((e) => e.kind === "impasse")).toHaveLength(1);
  });

  test("two Lesson requests in a row start only one Lesson, even before the first has started", async () => {
    const { backend, entries } = await replayDemo();
    const first = backend.dispatch({ type: "ask_why", text: "Why does a refresh log me out?" });
    const second = backend.dispatch({ type: "why", entryId: last(entries(), "file_edit")!.id });
    await first;
    await expect(second).rejects.toThrow(/already running/);
    await backend.settled();
    expect(entries().filter((e) => e.kind === "lesson_start")).toHaveLength(1);
  });

  test("messages in learning mode are follow-ups inside the Lesson and never reach the agent", async () => {
    const { backend, entries } = await inLesson();
    const lessonId = last(entries(), "lesson_start")!.lessonId;
    const userMessagesBefore = entries().filter((e) => e.kind === "user_message").length;
    await backend.dispatch({ type: "send_message", text: "What is a token?" });
    await backend.settled();
    expect(last(entries(), "lesson_question")).toMatchObject({ lessonId, text: "What is a token?" });
    expect(last(entries(), "lesson_card")).toMatchObject({ lessonId, step: "explain" });
    expect(entries().filter((e) => e.kind === "user_message")).toHaveLength(userMessagesBefore);
    expect(entries().filter((e) => e.kind === "lesson_start")).toHaveLength(1);
    expect(currentMode(entries())).toBe("learning");
  });

  test("Back to work ends the Lesson early, returns to work mode and records no Evidence", async () => {
    const { backend, entries, evidence } = await inLesson();
    const evidenceBefore = evidence.length;
    const probe = last(entries(), "lesson_card")!;
    await backend.dispatch({ type: "back_to_work" });
    await backend.settled();
    expect(last(entries(), "lesson_end")).toMatchObject({ lessonId: probe.lessonId, outcome: "abandoned" });
    expect(currentMode(entries())).toBe("work");
    expect(evidence).toHaveLength(evidenceBefore);
    // The abandoned Lesson's cards no longer accept answers; work messages go to the agent again.
    await expect(
      backend.dispatch({ type: "card_answer", lessonId: probe.lessonId, cardEntryId: probe.id, answer: { type: "text", text: "late" } }),
    ).rejects.toThrow(/no longer running/);
    await backend.dispatch({ type: "send_message", text: "Carry on" });
    expect(last(entries(), "user_message")?.text).toBe("Carry on");
  });

  test("a Lesson that fails to start returns the session to work mode", async () => {
    const modules = buildModules(allStubs, { script: demoSession });
    const failing: AhaModules = {
      ...modules,
      teaching: (o) => ({ ...modules.teaching(o), startLesson: async () => { throw new Error("teaching is down"); } }),
    };
    const errors: unknown[] = [];
    const backend = await createBackend({ modules: failing, projectDir, sessionId: DEMO_SESSION_ID, onLearningError: (e) => errors.push(e) });
    await backend.dispatch({ type: "ask_why", text: "Why?" });
    await backend.settled();
    expect(errors).toHaveLength(1);
    expect(currentMode(backend.timeline.entries())).toBe("work");
    await backend.dispatch({ type: "ask_why", text: "Why, again?" });
    expect(currentMode(backend.timeline.entries())).toBe("learning");
  });

  test("Back to work right after a Lesson request abandons that Lesson once it has started", async () => {
    const { backend, entries } = await replayDemo();
    await backend.dispatch({ type: "ask_why", text: "Why?" });
    await backend.dispatch({ type: "back_to_work" });
    await backend.settled();
    expect(kinds(entries()).filter((k) => k === "lesson_start" || k === "lesson_end")).toEqual(["lesson_start", "lesson_end"]);
    expect(modes(entries())).toEqual(["learning", "work"]);
  });
});

describe("Lesson failures and retries", () => {
  async function backendWith(change: (m: AhaModules) => AhaModules) {
    const errors: unknown[] = [];
    const backend = await createBackend({
      modules: change(buildModules(allStubs, { script: demoSession })),
      projectDir,
      sessionId: DEMO_SESSION_ID,
      onLearningError: (e) => errors.push(e),
    });
    return { backend, errors, entries: () => backend.timeline.entries() };
  }

  test("a failing Evidence write gate never stops the Lesson from starting", async () => {
    const { backend, errors, entries } = await backendWith((m) => ({
      ...m,
      decisions: { ...m.decisions, gateEvidence: async () => { throw new Error("write gate is down"); } },
    }));
    await backend.dispatch({ type: "ask_why", text: "Why?" });
    await backend.settled();
    expect(last(entries(), "lesson_card")?.step).toBe("probe");
    expect(currentMode(entries())).toBe("learning");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("a Learner Model that cannot be read returns the session to work mode", async () => {
    const { backend, errors, entries } = await backendWith((m) => ({
      ...m,
      learnerModel: (o) => ({ ...m.learnerModel(o), listConcepts: async () => { throw new Error("learner model is down"); } }),
    }));
    await backend.dispatch({ type: "ask_why", text: "Why?" });
    await backend.settled();
    expect(kinds(entries())).not.toContain("lesson_start");
    expect(currentMode(entries())).toBe("work");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("when teaching fails after an answer, the card shows an error and the user can retry", async () => {
    let failures = 1;
    const { backend, entries } = await backendWith((m) => ({
      ...m,
      teaching: (o) => {
        const inner = m.teaching(o);
        return { ...inner, answer: async (input) => (failures-- > 0 ? Promise.reject(new Error("model timed out")) : inner.answer(input)) };
      },
    }));
    await backend.dispatch({ type: "ask_why", text: "Why?" });
    await backend.settled();
    const probe = last(entries(), "lesson_card")!;
    await backend.dispatch({ type: "card_answer", lessonId: probe.lessonId, cardEntryId: probe.id, answer: { type: "text", text: "x" } });
    await backend.settled();
    expect(last(entries(), "lesson_error")).toMatchObject({ lessonId: probe.lessonId, cardEntryId: probe.id });
    expect(currentMode(entries())).toBe("learning");

    await backend.dispatch({ type: "retry_answer", lessonId: probe.lessonId, cardEntryId: probe.id });
    await backend.settled();
    expect(last(entries(), "lesson_card")?.step).toBe("articulate");
    await expect(backend.dispatch({ type: "retry_answer", lessonId: probe.lessonId, cardEntryId: probe.id })).rejects.toThrow(/nothing to retry/i);
  });

  test("Back to work still works after a failed answer", async () => {
    const { backend, entries } = await backendWith((m) => ({
      ...m,
      teaching: (o) => ({ ...m.teaching(o), answer: async () => { throw new Error("model timed out"); } }),
    }));
    await backend.dispatch({ type: "ask_why", text: "Why?" });
    await backend.settled();
    const probe = last(entries(), "lesson_card")!;
    await backend.dispatch({ type: "card_answer", lessonId: probe.lessonId, cardEntryId: probe.id, answer: { type: "text", text: "x" } });
    await backend.settled();
    await backend.dispatch({ type: "back_to_work" });
    await backend.settled();
    expect(currentMode(entries())).toBe("work");
  });

  test("after Back to work a new Lesson gets a new id, and the old Lesson's cards stay closed", async () => {
    const { backend, entries } = await replayDemo();
    await backend.dispatch({ type: "ask_why", text: "First?" });
    await backend.settled();
    const oldProbe = last(entries(), "lesson_card")!;
    await backend.dispatch({ type: "back_to_work" });
    await backend.settled();
    await backend.dispatch({ type: "ask_why", text: "Second?" });
    await backend.settled();
    const newProbe = last(entries(), "lesson_card")!;
    expect(newProbe.lessonId).not.toBe(oldProbe.lessonId);
    await expect(
      backend.dispatch({ type: "card_answer", lessonId: oldProbe.lessonId, cardEntryId: oldProbe.id, answer: { type: "text", text: "late" } }),
    ).rejects.toThrow(/no longer running/);
  });
});

describe("module configuration", () => {
  test("each module can be set to stub or real in the config file or the environment", () => {
    const file = join(import.meta.dirname, "../aha.config.json");
    expect(readConfig(file, {})).toEqual(allStubs);
    expect(readConfig(file, { AHA_BACKGROUND: "real" }).background).toBe("real");
    expect(() => readConfig(file, { AHA_DECISIONS: "jev" })).toThrow(/stub" or "real/);
  });

  test("a real implementation that does not exist yet fails with a clear message", () => {
    expect(() => buildModules({ ...allStubs, learnerModel: "real" })).toThrow(/No real implementation of learnerModel yet/);
    expect(buildModules({ ...allStubs, decisions: "real" }).decisions.detectImpasse).toBeTypeOf("function");
    expect(buildModules({ ...allStubs, background: "real" }).background).toBeDefined();
  });
});
