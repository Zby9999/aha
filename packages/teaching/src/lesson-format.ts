import { MASTERY_LEVELS, type Impasse, type LearnerContext } from "@aha/contracts";

export function relevantConcepts(impasse: Impasse, learner: LearnerContext) {
  return impasse.conceptIds.length
    ? learner.concepts.filter(({ id }) => impasse.conceptIds.includes(id))
    : learner.concepts;
}

export function lessonFormat(impasse: Impasse, learner: LearnerContext) {
  const concepts = relevantConcepts(impasse, learner);
  if (!concepts.length || impasse.conceptIds.some((id) => !concepts.some((concept) => concept.id === id))) return "full";
  const level = Math.min(...concepts.map(({ mastery }) => MASTERY_LEVELS.indexOf(mastery)));
  switch (MASTERY_LEVELS[level]) {
    case "seen_explanation": return "probe_first";
    case "correct_with_hints": return "hint";
    case "explains_independently": return "direct";
    case "catches_agent_mistakes": return "review";
    default: return "full";
  }
}
