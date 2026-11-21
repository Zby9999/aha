import { join } from "node:path";
import { createBackend } from "@aha/app";
import type { AhaModules, LearnerModelStore, TimelineEntry } from "@aha/contracts";
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
  const withStore: AhaModules = { ...modules, learnerModel: (o) => (store = modules.learnerModel(o)) };
  const backend = await createBackend({ modules: withStore, projectDir, sessionId: DEMO_SESSION_ID, onLearningError: (e) => { throw e; } });
  await replayUntilOffer(backend, demoSession);
  return { backend, store: store!, entries: () => backend.timeline.entries() };
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

  test("declining the Offer starts no Lesson and records no Evidence", async () => {
    const { backend, store, entries } = await replayDemo();
    const before = await store.listConcepts();
    await backend.dispatch({ type: "offer_response", impasseId: last(entries(), "offer")!.impasseId, response: "decline" });
    await backend.settled();
    expect(kinds(entries())).not.toContain("lesson_start");
    expect(await store.listConcepts()).toEqual(before);
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

describe("module configuration", () => {
  test("each module can be set to stub or real in the config file or the environment", () => {
    const file = join(import.meta.dirname, "../aha.config.json");
    expect(readConfig(file, {})).toEqual(allStubs);
    expect(readConfig(file, { AHA_BACKGROUND: "real" }).background).toBe("real");
    expect(() => readConfig(file, { AHA_DECISIONS: "jev" })).toThrow(/stub" or "real/);
  });

  test("a real implementation that does not exist yet fails with a clear message", () => {
    expect(() => buildModules({ ...allStubs, decisions: "real" })).toThrow(/No real implementation of decisions yet/);
    expect(buildModules({ ...allStubs, background: "real" }).background).toBeDefined();
  });
});
