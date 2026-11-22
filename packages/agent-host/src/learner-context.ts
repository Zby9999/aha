import type { LearnerContext, MasteryLevel } from "@aha/contracts";

const MASTERY_TEXT: Record<MasteryLevel, string> = {
  not_encountered: "has not met it yet",
  seen_explanation: "has seen an explanation",
  correct_with_hints: "gets it right with hints",
  explains_independently: "explains it independently",
  catches_agent_mistakes: "catches the agent's mistakes with it",
};

/** Evidence notes shown per Concept, newest first. */
const NOTES_PER_CONCEPT = 2;

/**
 * Learner-model text (Concept names, file paths, Evidence notes) is user-editable and may be model-written. Pi puts
 * the section into the prompt verbatim inside a tag, so keep each item on one line and out of tag syntax.
 */
const clean = (text: string) => text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

/**
 * The learner context as text for Pi's system prompt: what the user understands of each relevant Concept, so the
 * agent pitches its replies at that level. Empty when there are no Concepts.
 */
export function renderLearnerContext(context: LearnerContext | null): string {
  if (!context || context.concepts.length === 0) return "";
  const lines = context.concepts.map((concept) => {
    const files = concept.relatedFiles.length > 0 ? ` Related files: ${concept.relatedFiles.map(clean).join(", ")}.` : "";
    const notes = [...concept.evidence]
      .sort((a, b) => b.at.localeCompare(a.at)) // ISO 8601 times sort as text

      .slice(0, NOTES_PER_CONCEPT)
      .map((e) => ` ${e.outcome === "positive" ? "Showed" : "Gap"}: ${clean(e.note)}`)
      .join("");
    return `- ${clean(concept.name)}: the user ${MASTERY_TEXT[concept.mastery]}.${files}${notes}`;
  });
  return [
    "The user is a beginner learning while you build their project. Aha's learner model says this about the concepts in play:",
    ...lines,
    "Pitch explanations at this level: briefly name the concept when a change depends on one they are still learning, and do not re-explain what they already explain on their own.",
  ].join("\n");
}
