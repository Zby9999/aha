import { MASTERY_LEVELS, type Concept, type Evidence, type MasteryLevel } from "@aha/contracts";

/** Evidence-only progression. A lesson explanation alone never demonstrates understanding. */
export function masteryFromEvidence(current: MasteryLevel, evidence: readonly Evidence[]): MasteryLevel {
  const positive = evidence.filter((item) => item.outcome === "positive");
  const judgedFix = positive.some((item) => item.type === "fix_judgement" && item.strength === "strong");
  const explained = positive.some((item) => item.type === "articulation" && item.strength === "strong");
  const observed: MasteryLevel = positive.some((item) => item.type === "caught_agent_mistake") || judgedFix && explained
    ? "catches_agent_mistakes"
    : positive.some((item) => item.type === "independent_fix")
      ? "explains_independently"
      : positive.some((item) => item.type === "probe_result" || item.type === "articulation")
        ? "correct_with_hints" : current;
  return MASTERY_LEVELS.indexOf(observed) > MASTERY_LEVELS.indexOf(current) ? observed : current;
}

/** The model proposes ids; the store validates them and owns every write. */
export function proposedMerges(text: string, concepts: readonly Concept[]): { from: string[]; into: string }[] {
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { merges?: unknown };
    if (!Array.isArray(json.merges)) return [];
    const known = new Set(concepts.map((item) => item.id));
    return json.merges.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const { from, into } = item as { from?: unknown; into?: unknown };
      if (typeof into !== "string" || !known.has(into) || !Array.isArray(from) || from.length === 0 || !from.every((id) => typeof id === "string" && known.has(id) && id !== into)) return [];
      return [{ from: [...new Set(from)] as string[], into }];
    });
  } catch {
    return [];
  }
}
