import type { TeachingOptions } from "@aha/contracts";
import { expect, test } from "vitest";
import { createStubTeaching } from "../src/stub.ts";

test("Lesson ids never repeat, even after a Lesson is abandoned", async () => {
  // The stub uses neither the decision service nor the background agent.
  const teaching = createStubTeaching({ decisions: {}, background: {} } as unknown as TeachingOptions);
  const impasse = { id: "i1", trigger: "ask_why" as const, title: "Why?", conceptIds: [], sourceEntryIds: [] };
  const input = { impasse, learner: { concepts: [] }, project: { projectDir: "/p", files: [] }, timeline: [] };
  const lessonId = (entries: Awaited<ReturnType<typeof teaching.startLesson>>) => entries.find((e) => e.kind === "lesson_start")!.lessonId;

  const first = lessonId(await teaching.startLesson(input));
  await teaching.abandon(first);
  const second = lessonId(await teaching.startLesson(input));
  expect(second).not.toBe(first);
});
