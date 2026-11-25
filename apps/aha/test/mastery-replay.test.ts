import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createBackend } from "@aha/app";
import { currentMode, isKind, type UserAction } from "@aha/contracts";
import { DEMO_CONCEPTS, demoSession } from "@aha/contracts/fixtures";
import { expect, test } from "vitest";
import { buildModules, readConfig } from "../src/modules.ts";
import { replayUntilOffer } from "../src/replay.ts";

test("the third recorded turn leads to a shorter Lesson for a concept learned in the first Lesson", async () => {
  const projectDir = join(import.meta.dirname, "../../../examples/portfolio");
  const config = readConfig(join(import.meta.dirname, "../aha.config.json"), {});
  const modules = buildModules({ ...config, teaching: "real" }, { script: demoSession });
  const learner = modules.learnerModel({ projectDir, background: modules.background });
  const sessionTokens = DEMO_CONCEPTS.sessionToken;
  const errors: unknown[] = [];
  let relatedEditId: string | undefined;
  const backend = await createBackend({
    projectDir,
    sessionId: "mastery-replay",
    onLearningError: (error) => errors.push(error),
    modules: {
      ...modules,
      learnerModel: () => learner,
      decisions: {
        ...modules.decisions,
        async selectConcepts(input) {
          if (input.impasse.trigger === "why" && relatedEditId && input.impasse.sourceEntryIds.includes(relatedEditId)) {
            return input.concepts.filter(({ id }) => id === sessionTokens).map(({ id }) => id);
          }
          return modules.decisions.selectConcepts(input);
        },
      },
    },
  });
  const entries = () => backend.timeline.entries();
  const lessonCards = (lessonId: string) => entries().filter((entry) => isKind(entry, "lesson_card")).filter((entry) => entry.lessonId === lessonId);
  const act = async (action: UserAction) => {
    await backend.dispatch(action);
    await backend.settled();
  };

  try {
    await replayUntilOffer(backend, demoSession);
    expect(await learner.listConcepts()).toEqual([]);
    const offer = entries().findLast((entry) => isKind(entry, "offer"))!;
    await act({ type: "offer_response", impasseId: offer.impasseId, response: "accept" });
    const firstProbe = entries().findLast((entry) => isKind(entry, "lesson_card"))!;
    expect(firstProbe.step).toBe("probe");
    await act({ type: "card_answer", lessonId: firstProbe.lessonId, cardEntryId: firstProbe.id, answer: { type: "choice", optionId: "same" } });
    const firstCards = lessonCards(firstProbe.lessonId);
    expect(firstCards.map(({ step }) => step)).toEqual(["probe", "explain", "articulate"]);
    await act({ type: "card_answer", lessonId: firstProbe.lessonId, cardEntryId: firstCards[2]!.id, answer: { type: "fix_judgement", addressesCause: false } });
    expect(entries().findLast((entry) => isKind(entry, "lesson_end"))).toMatchObject({ lessonId: firstProbe.lessonId, outcome: "completed" });
    expect(currentMode(entries())).toBe("work");

    const judgement = entries().findLast((entry) => isKind(entry, "card_answer"))!;
    expect(await learner.readConcepts([sessionTokens])).toMatchObject([{
      id: sessionTokens,
      mastery: "seen_explanation",
      evidence: expect.arrayContaining([expect.objectContaining({
        type: "fix_judgement", outcome: "positive", entryIds: expect.arrayContaining([judgement.id]),
      })]),
    }]);

    const thirdMessage = demoSession.filter((entry) => isKind(entry, "user_message")).filter((entry) => entry.source === "agent-host")[2]!;
    const recordedEdit = demoSession.filter((entry) => isKind(entry, "file_edit")).find((entry) => entry.seq > thirdMessage.seq && entry.path === "server.js")!;
    const sourcePath = join(projectDir, recordedEdit.path);
    const sourceBefore = await readFile(sourcePath, "utf8");
    const countBeforeTurn = entries().length;
    await act({ type: "send_message", text: thirdMessage.text });
    const newEdit = entries().slice(countBeforeTurn).filter((entry) => isKind(entry, "file_edit")).find((entry) => entry.path === "server.js")!;
    expect(newEdit).toMatchObject({ source: "agent-host", path: recordedEdit.path, change: recordedEdit.change, diff: recordedEdit.diff });
    // The agent host replays edit entries on the Timeline without applying their diffs to the portfolio source.
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBefore);

    relatedEditId = newEdit.id;
    await act({ type: "why", entryId: newEdit.id });
    expect(entries().findLast((entry) => isKind(entry, "impasse"))?.impasse).toMatchObject({ trigger: "why", sourceEntryIds: [newEdit.id] });
    const secondProbe = entries().findLast((entry) => isKind(entry, "lesson_card"))!;
    expect(secondProbe.step).toBe("probe");
    expect(secondProbe.lessonId).not.toBe(firstProbe.lessonId);
    await act({ type: "card_answer", lessonId: secondProbe.lessonId, cardEntryId: secondProbe.id, answer: { type: "choice", optionId: "new" } });

    const secondCards = lessonCards(secondProbe.lessonId);
    const secondEnd = entries().findLast((entry) => isKind(entry, "lesson_end"))!;
    expect(secondCards.map(({ step }) => step)).toEqual(["probe", "explain"]);
    expect(secondEnd).toMatchObject({ lessonId: secondProbe.lessonId, outcome: "completed" });
    expect(secondEnd.seq).toBeGreaterThan(secondCards[1]!.seq);
    expect(currentMode(entries())).toBe("work");
    expect(errors).toEqual([]);
  } finally {
    await backend.stop();
  }
});
