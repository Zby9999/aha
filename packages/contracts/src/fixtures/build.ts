import type { CardSpec, CatalogComponent } from "../cards.ts";
import { createTimeline, type NewTimelineEntry, type TimelineEntry } from "../timeline.ts";

/** Builds a fixture Timeline with deterministic ids (`<sessionId>:<seq>`) and times (5 s apart). */
export function fixtureTimeline(sessionId: string, start: string) {
  let tick = 0;
  const startMs = Date.parse(start);
  const timeline = createTimeline({ sessionId, now: () => new Date(startMs + 5000 * tick++) });
  return {
    /** Appends an entry and returns its id, for later entries to refer to. */
    add(entry: NewTimelineEntry): string {
      return timeline.append(entry).id;
    },
    entries(): TimelineEntry[] {
      return [...timeline.entries()];
    },
  };
}

/** A one-element json-render Spec for a catalog card. */
export function card(type: CatalogComponent, props: object): CardSpec {
  return { root: "card", elements: { card: { type, props: props as Record<string, unknown>, children: [] } } };
}
