import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { createTimeline, isKind, type Citation, type TimelineEntry } from "../src/index.ts";
import {
  DEMO_PROJECT_FILES,
  DEMO_SESSION_ID,
  demoSession,
  expectedConceptsAfterDemo,
  expectedEvidenceAfterDemo,
} from "../src/fixtures/index.ts";

const repoRoot = join(import.meta.dirname, "../../..");
const projectRoot = join(repoRoot, "examples/portfolio");
const learnerModelDir = join(import.meta.dirname, "../fixtures/learner-model/after-demo");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : filesUnder(path);
    return [relative(projectRoot, path)];
  });
}

function citationsIn(value: unknown): Citation[] {
  if (Array.isArray(value)) return value.flatMap(citationsIn);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [...(Array.isArray(record.citations) ? (record.citations as Citation[]) : []), ...Object.values(record).flatMap(citationsIn)];
  }
  return [];
}

function pathsIn(entry: TimelineEntry): string[] {
  switch (entry.kind) {
    case "file_edit":
      return [entry.path];
    case "error":
      return entry.path ? [entry.path] : [];
    case "tool_call":
      return typeof entry.args.path === "string" ? [entry.args.path] : [];
    case "offer":
    case "lesson_card":
      return citationsIn(entry.card).map((c) => c.path);
    default:
      return [];
  }
}

const byId = new Map(demoSession.map((e) => [e.id, e]));
const ofKind = <K extends TimelineEntry["kind"]>(kind: K) => demoSession.filter((e) => isKind(e, kind)) as Extract<TimelineEntry, { kind: K }>[];

describe("demo session fixture", () => {
  test("is a valid Timeline for one session", () => {
    const timeline = createTimeline({ sessionId: DEMO_SESSION_ID, initial: demoSession });
    expect(timeline.entries()).toHaveLength(demoSession.length);
    expect(demoSession[0]?.kind).toBe("session_start");
    expect(demoSession.at(-1)?.kind).toBe("session_end");
  });

  test("lists exactly the files of the example project", () => {
    expect(filesUnder(projectRoot).sort()).toEqual([...DEMO_PROJECT_FILES].sort());
  });

  test("every file path and citation exists in the example project", () => {
    const paths = [...demoSession.flatMap(pathsIn), ...expectedConceptsAfterDemo.flatMap((c) => c.relatedFiles)];
    expect(paths.length).toBeGreaterThan(10);
    expect(paths.filter((p) => !existsSync(join(projectRoot, p)))).toEqual([]);
  });

  test("cited line ranges exist in the cited files", () => {
    const bad = demoSession.flatMap((e) =>
      citationsIn(e).filter((c) => (c.endLine ?? c.startLine ?? 0) > readFileSync(join(projectRoot, c.path), "utf8").split("\n").length),
    );
    expect(bad).toEqual([]);
  });

  test("every reference points to an earlier entry", () => {
    const refs = demoSession.flatMap((e): (readonly [TimelineEntry, string])[] => {
      if (isKind(e, "impasse")) return e.impasse.sourceEntryIds.map((id) => [e, id] as const);
      if (isKind(e, "card_answer")) return [[e, e.cardEntryId] as const];
      if (isKind(e, "answer_assessment")) return [[e, e.answerEntryId] as const];
      return [];
    });
    for (const [entry, id] of refs) expect(byId.get(id)?.seq, `${entry.id} → ${id}`).toBeLessThan(entry.seq);
  });

  test("covers agent edits, a repeated error, a Why request, a full Lesson and a second related Impasse", () => {
    expect(ofKind("file_edit").length).toBeGreaterThanOrEqual(2);

    const errors = ofKind("error").map((e) => e.message);
    expect(errors.filter((m) => m === errors[0]).length).toBeGreaterThanOrEqual(2);

    const [first, second] = ofKind("impasse").map((e) => e.impasse);
    expect(first?.trigger).toBe("detected");
    expect(second?.trigger).toBe("why");
    expect(second?.conceptIds.some((id) => first?.conceptIds.includes(id))).toBe(true);

    const offers = ofKind("offer");
    expect(offers.map((o) => o.impasseId)).toEqual([first?.id]);
    expect(offers[0]?.card.elements[offers[0].card.root]?.type).toBe("OfferCard");

    const lessonOne = ofKind("lesson_card").filter((c) => c.lessonId === "lesson-1").map((c) => c.step);
    expect(lessonOne).toEqual(["probe", "explain", "articulate"]);
    expect(ofKind("lesson_end").map((e) => [e.lessonId, e.outcome])).toEqual([
      ["lesson-1", "completed"],
      ["lesson-2", "completed"],
    ]);
  });
});

describe("expected learner model after the demo session", () => {
  test("has one Evidence per Concept of each answer assessment, plus the repeated gap", () => {
    const fromAssessments = ofKind("answer_assessment").flatMap((a) =>
      a.conceptIds.map((conceptId) => `${conceptId}@${a.id}`),
    );
    const evidenceFromAssessments = expectedEvidenceAfterDemo
      .filter((e) => e.type !== "repeated_gap")
      .map((e) => `${e.conceptId}@${e.entryIds.at(-1)}`);
    expect(evidenceFromAssessments.sort()).toEqual(fromAssessments.sort());
    expect(expectedEvidenceAfterDemo.every((e) => e.entryIds.every((id) => byId.has(id)))).toBe(true);
  });

  test("includes the Markdown files for every Concept, with the same Mastery Levels", () => {
    expect(existsSync(join(learnerModelDir, "index.md"))).toBe(true);
    expect(existsSync(join(learnerModelDir, "changelog.md"))).toBe(true);
    for (const concept of expectedConceptsAfterDemo) {
      const markdown = readFileSync(join(learnerModelDir, "concepts", `${concept.id}.md`), "utf8");
      expect(markdown).toContain(`mastery: ${concept.mastery}`);
      const evidenceIds = expectedEvidenceAfterDemo.filter((e) => e.conceptId === concept.id).map((e) => e.id);
      for (const id of evidenceIds) expect(markdown).toContain(`${id} ·`);
    }
  });

  test("session log lists every Evidence", () => {
    const log = readFileSync(join(learnerModelDir, "sessions", `${DEMO_SESSION_ID}.md`), "utf8");
    for (const evidence of expectedEvidenceAfterDemo) {
      expect(log).toContain(`## ${evidence.id}\n- concept: ${evidence.conceptId}`);
    }
  });
});
