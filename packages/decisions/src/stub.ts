import type { DecisionService, Impasse, TimelineEntry } from "@aha/contracts";
import { cardDecisions } from "./cards.ts";

/**
 * Decision service stub: fixed rules instead of Jev.
 * - Impasse: the same project error message twice (e.g. a browser 401), once per message. The agent's own agent
 *   and tool errors are its problem, not a gap in the user's understanding, so they never count.
 * - Write gate: a detected Impasse is negative repeated-gap Evidence for its Concepts.
 * - Read gate: the Impasse's own Concepts that exist in the model.
 */
export function createStubDecisions(): DecisionService {
  return {
    async detectImpasse({ timeline }) {
      const errors = timeline.filter(
        (e): e is Extract<TimelineEntry, { kind: "error" }> => e.kind === "error" && e.origin === "project",
      );
      const last = errors.at(-1);
      if (!last) return null;
      const same = errors.filter((e) => e.message === last.message);
      const alreadyRaised = timeline.some(
        (e) => e.kind === "impasse" && e.impasse.sourceEntryIds.includes(same[0]!.id),
      );
      if (same.length < 2 || alreadyRaised) return null;
      const impasse: Impasse = {
        id: `impasse-${timeline.filter((e) => e.kind === "impasse").length + 1}`,
        trigger: "detected",
        title: `The same error keeps coming back: ${last.message}`,
        conceptIds: [],
        sourceEntryIds: same.map((e) => e.id),
      };
      return { impasse, reason: `"${last.message}" happened ${same.length} times` };
    },
    async gateEvidence({ newEntries }) {
      return newEntries.flatMap((entry) =>
        entry.kind === "impasse" && entry.impasse.trigger === "detected"
          ? entry.impasse.conceptIds.map((conceptId) => ({
              conceptId,
              type: "repeated_gap" as const,
              outcome: "negative" as const,
              strength: "moderate" as const,
              entryIds: [entry.id, ...entry.impasse.sourceEntryIds],
              note: entry.impasse.title,
            }))
          : [],
      );
    },
    async selectConcepts({ impasse, concepts }) {
      return concepts.filter((c) => impasse.conceptIds.includes(c.id)).map((c) => c.id);
    },
    ...cardDecisions,
  };
}
