import { describe, expect, test } from "vitest";
import { cardComponentDefinitions, CATALOG_COMPONENTS, probeCardSchema } from "../src/index.ts";
import { demoSession } from "../src/fixtures/index.ts";

const cards = demoSession.flatMap((e) => (e.kind === "offer" || e.kind === "lesson_card" ? [e.card] : []));

describe("lesson-card catalog", () => {
  test("defines only components named in CATALOG_COMPONENTS", () => {
    for (const name of Object.keys(cardComponentDefinitions)) expect(CATALOG_COMPONENTS).toContain(name);
  });

  test("the demo fixture's cards match their catalog props", () => {
    const checked = cards.flatMap((card) => {
      const root = card.elements[card.root]!;
      const definition = cardComponentDefinitions[root.type as keyof typeof cardComponentDefinitions];
      if (!definition) return [];
      expect(definition.props.safeParse(root.props).error).toBeUndefined();
      return [root.type];
    });
    expect(new Set(checked)).toEqual(new Set(["OfferCard", "ProbeCard", "ArticulationCard"]));
  });

  test("rejects a card with missing props", () => {
    expect(probeCardSchema.safeParse({ lessonId: "l1" }).success).toBe(false);
  });
});
