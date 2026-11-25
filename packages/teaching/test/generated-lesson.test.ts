import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTimeline, type BackgroundRunRequest, type LessonInput, type NewTimelineEntry, type TeachingOptions } from "@aha/contracts";
import { expect, test, vi } from "vitest";
import { createTeaching } from "../src/index.ts";

const source = "\n".repeat(231) + "let page = 1;\nexport function reset() { page = 1; }\n";
const citations = [{ path: "paging.ts", startLine: 232, endLine: 233 }];
const createProbe = { question: "What page will reset show?", citations };
const explanation = {
  component: "DataFlowDiagram",
  props: {
    title: "Reset goes to page 1",
    summary: "You expected page 4. reset assigns 1 to page.",
    nodes: [{ id: "reset", label: "User resets" }, { id: "first", label: "Page 1" }],
    edges: [{ from: "reset", to: "first", label: "Assign 1 to page" }],
    citations,
  },
};
const invalidCitation = { ...explanation, props: { ...explanation.props, citations: [{ path: "paging.ts", startLine: 99 }] } };
const cyclicDiagram = {
  ...explanation, props: { ...explanation.props, edges: [...explanation.props.edges, { from: "first", to: "reset", label: "Re-renders" }] },
};

test.each(["repaired diagram", "grounded text fallback", "invalid text fallback"] as const)("generated Lesson with %s", async (scenario) => {
  const projectDir = await mkdtemp(join(tmpdir(), "aha-generated-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "aha-external-"));
  try {
    await writeFile(join(projectDir, "paging.ts"), source);
    await writeFile(join(outsideDir, "secret.ts"), "PRIVATE_EXTERNAL_SOURCE");
    if (process.platform !== "win32") await symlink(join(outsideDir, "secret.ts"), join(projectDir, "alias.ts"));
    const timeline = createTimeline({ sessionId: "live" });
    timeline.append({ kind: "user_message", source: "agent-host", text: "Reset jumps to the first page." });
    const edit = timeline.append({ kind: "file_edit", source: "agent-host", path: "paging.ts", change: "modify", diff: "@@ -233 +233 @@\n+  page = 1;" });
    const input: LessonInput = {
      impasse: { id: "reset", trigger: "why", title: "Why does resetting change page?", sourceEntryIds: [edit.id], conceptIds: [] },
      learner: { concepts: [] },
      project: { projectDir, files: ["alias.ts", "paging.ts"] },
      timeline: timeline.entries(),
    };
    const usesFallback = scenario !== "repaired diagram";
    const invalidFallback = scenario === "invalid text fallback";
    const textExplanation = {
      component: "TextExplanation",
      props: { title: "Reset goes to page 1", text: "Reset assigns 1 to page.", citations: invalidFallback ? invalidCitation.props.citations : citations },
    };
    const outputs = [
      createProbe,
      ...(usesFallback ? [explanation, cyclicDiagram, textExplanation] : [invalidCitation, explanation]),
      { component: "TextExplanation", props: { title: "Where the value goes", text: "The page variable is updated in memory.", citations } },
    ];
    const run = vi.fn(async (_request: BackgroundRunRequest) => ({ text: JSON.stringify(outputs.shift()), filesWritten: [] }));
    const checkGrounding = vi.fn(async () => ({ grounded: true, missingFiles: [], reason: "Supported by paging.ts" }));
    if (usesFallback) checkGrounding.mockResolvedValueOnce({ grounded: false, missingFiles: [], reason: "Claim not supported" });
    const options: TeachingOptions = { background: { run }, decisions: { checkGrounding, async chooseComponent() { return "DataFlowDiagram"; } } };
    const lesson = createTeaching(options);
    const append = (entries: NewTimelineEntry[]) => entries.map((entry) => timeline.append(entry));

    const started = append(await lesson.startLesson(input));
    const probe = started.find((entry) => entry.kind === "lesson_card")!;
    expect(probe.card.elements[probe.card.root]?.props).toMatchObject(createProbe);
    const request = run.mock.calls[0]![0];
    expect(request.tools).toEqual([]);
    expect(request.prompt).toContain("233: export function reset()");
    expect(request.prompt).toContain("+  page = 1;");
    expect(request.prompt).toContain("Reset jumps to the first page.");
    expect(request.prompt).not.toContain("PRIVATE_EXTERNAL_SOURCE");

    const answer = { type: "text", text: "I think it will keep page 4." } as const;
    timeline.append({ kind: "card_answer", source: "app", lessonId: probe.lessonId, cardEntryId: probe.id, step: "probe", answer });
    const response = lesson.answer({ lessonId: probe.lessonId, cardEntryId: probe.id, answer, timeline: timeline.entries() });
    if (invalidFallback) {
      await expect(response).rejects.toThrow(/accurate citations/);
      expect(run).toHaveBeenCalledTimes(4);
      expect(checkGrounding).toHaveBeenCalledTimes(1);
      return;
    }

    const next = append(await response);
    expect(run).toHaveBeenCalledTimes(usesFallback ? 4 : 3);
    expect(run.mock.lastCall?.[0].prompt).toContain(answer.text);
    const accepted = usesFallback ? textExplanation : explanation;
    expect(next[0]).toMatchObject({
      kind: "lesson_card", step: "explain", card: { elements: { card: { type: accepted.component, props: { citations } } } },
    });
    expect(checkGrounding).toHaveBeenCalledTimes(usesFallback ? 2 : 1);
    expect(checkGrounding).toHaveBeenLastCalledWith(expect.objectContaining({ citations, latestChange: edit }));

    const followUp = "Is page stored in local storage?";
    await expect(lesson.followUp({ lessonId: probe.lessonId, question: followUp, timeline: timeline.entries() }))
      .resolves.toEqual([expect.objectContaining({ kind: "lesson_card", lessonId: probe.lessonId, step: "explain" })]);
    expect(run.mock.lastCall?.[0].prompt).toContain(followUp);
    expect(run.mock.lastCall?.[0].prompt).toContain(answer.text);
    const final = next.find((entry) => entry.kind === "lesson_card" && entry.step === "articulate")!;
    const restated = { type: "text", text: "Reset assigns 1." } as const;
    timeline.append({ kind: "card_answer", source: "app", lessonId: probe.lessonId, cardEntryId: final.id, step: "articulate", answer: restated });
    await expect(lesson.answer({ lessonId: probe.lessonId, cardEntryId: final.id, answer: restated, timeline: timeline.entries() }))
      .resolves.toEqual([expect.objectContaining({ kind: "lesson_end", outcome: "completed" })]);
  } finally {
    await Promise.all([rm(projectDir, { recursive: true, force: true }), rm(outsideDir, { recursive: true, force: true })]);
  }
});
