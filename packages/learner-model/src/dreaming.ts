import { MASTERY_LEVELS, type Concept, type Evidence, type MasteryLevel } from "@aha/contracts";

const atLeast = (level: MasteryLevel, floor: MasteryLevel) => MASTERY_LEVELS.indexOf(level) >= MASTERY_LEVELS.indexOf(floor) ? level : floor;

/**
 * Evidence-only progression; a level never goes down. A lesson explanation alone never demonstrates understanding.
 * One observation reaches at most
 * `correct_with_hints`; the top two levels need two positive observations, one of them of the matching kind.
 */
export function masteryFromEvidence(current: MasteryLevel, evidence: readonly Evidence[]): MasteryLevel {
  // Two records of the same entries (for example a duplicate write-gate decision) are one observation.
  const observations = [...new Map(evidence.map((item) => [`${item.outcome}:${item.type}:${item.entryIds.join(",")}`, item])).values()];
  const positive = observations.filter((item) => item.outcome === "positive" && item.type !== "repeated_gap");
  const strong = (type: Evidence["type"]) => positive.some((item) => item.type === type && item.strength === "strong");
  let observed: MasteryLevel = "not_encountered";
  if (positive.length >= 1) observed = "correct_with_hints";
  if (positive.length >= 2 && (positive.some((item) => item.type === "independent_fix") || strong("articulation"))) observed = "explains_independently";
  if (positive.length >= 2 && (positive.some((item) => item.type === "caught_agent_mistake") || strong("fix_judgement") && strong("articulation"))) {
    observed = "catches_agent_mistakes";
  }
  return atLeast(current, observed);
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
