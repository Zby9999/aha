import { MASTERY_LEVELS, type Impasse, type LearnerContext } from "@aha/contracts";

export function relevantConcepts(impasse: Impasse, learner: LearnerContext) {
  return impasse.conceptIds.length
    ? learner.concepts.filter(({ id }) => impasse.conceptIds.includes(id))
    : learner.concepts;
}

export function lessonFormat(impasse: Impasse, learner: LearnerContext) {
  const relevant = relevantConcepts(impasse, learner);
  if (!relevant.length || impasse.conceptIds.some((id) => !relevant.some((concept) => concept.id === id))) return "full";
  // The read gate does not mark a primary Concept. An unseen Concept may be the learning target,
  // even when another selected Concept is already familiar.
  const level = Math.min(...relevant.map(({ mastery }) => MASTERY_LEVELS.indexOf(mastery)));
  switch (MASTERY_LEVELS[level]) {
    case "seen_explanation": return "probe_first";
    case "correct_with_hints": return "hint";
    case "explains_independently": return "direct";
    case "catches_agent_mistakes": return "review";
    default: return "full";
  }
}
