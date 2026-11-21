import type { NewTimelineEntry, Teaching, TeachingFactory } from "@aha/contracts";
import { card } from "@aha/contracts/fixtures";

/** Teaching stub: fixed card text, the full Probe → Explain → Articulate sequence, a plain-text answer to follow-ups, no Pi. */
export const createStubTeaching: TeachingFactory = (): Teaching => {
  const lessons = new Map<string, { conceptIds: string[]; files: string[] }>();

  return {
    async offer({ impasse }) {
      return card("OfferCard", {
        impasseId: impasse.id,
        title: "Want a quick look at why this keeps happening?",
        body: impasse.title,
      });
    },
    async startLesson({ impasse, project }) {
      const lessonId = `lesson-${lessons.size + 1}`;
      lessons.set(lessonId, { conceptIds: impasse.conceptIds, files: project.files });
      return [
        { kind: "lesson_start", source: "teaching", lessonId, impasseId: impasse.id },
        {
          kind: "lesson_card",
          source: "teaching",
          lessonId,
          step: "probe",
          card: card("ProbeCard", { lessonId, question: `Before we look: what do you think causes "${impasse.title}"?`, citations: [] }),
        },
      ];
    },
    async answer({ lessonId, cardEntryId, timeline }) {
      const lesson = lessons.get(lessonId);
      const answered = timeline.find((e) => e.id === cardEntryId);
      const answerEntry = timeline.findLast((e) => e.kind === "card_answer" && e.cardEntryId === cardEntryId);
      if (!lesson || answered?.kind !== "lesson_card" || !answerEntry) return [];
      const step = answered.step === "explain" ? "probe" : answered.step;
      const entries: NewTimelineEntry[] = [
        {
          kind: "answer_assessment",
          source: "teaching",
          lessonId,
          answerEntryId: answerEntry.id,
          step,
          conceptIds: lesson.conceptIds,
          result: step === "probe" ? "partial" : "correct",
        },
      ];
      if (step === "probe") {
        const cited = lesson.files.slice(0, 1).map((path) => ({ path }));
        entries.push(
          {
            kind: "lesson_card",
            source: "teaching",
            lessonId,
            step: "explain",
            card: card("TextExplanation", { title: "What is going on (stub)", text: "A real explanation will cite your files here.", citations: cited }),
          },
          {
            kind: "lesson_card",
            source: "teaching",
            lessonId,
            step: "articulate",
            card: card("ArticulationCard", { lessonId, prompt: "Say it in your own words.", mode: "restate", citations: cited }),
          },
        );
      } else {
        entries.push({ kind: "lesson_end", source: "teaching", lessonId, outcome: "completed" });
      }
      return entries;
    },
    async followUp({ lessonId, question }) {
      if (!lessons.has(lessonId)) return [];
      return [
        {
          kind: "lesson_card",
          source: "teaching",
          lessonId,
          step: "explain",
          card: card("TextExplanation", {
            title: "Good question (stub)",
            text: `A real answer to "${question}" will build on this Lesson and cite your files.`,
            citations: [],
          }),
        },
      ];
    },
    async abandon(lessonId) {
      lessons.delete(lessonId);
      return [{ kind: "lesson_end", source: "teaching", lessonId, outcome: "abandoned" }];
    },
  };
};
