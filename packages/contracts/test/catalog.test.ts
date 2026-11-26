import { describe, expect, test } from "vitest";
import { lessonCardComponentDefinitions, CATALOG_COMPONENTS, probeCardSchema, textExplanationSchema } from "../src/index.ts";
import { demoSession } from "../src/fixtures/index.ts";

const cards = demoSession.flatMap((e) => (e.kind === "offer" || e.kind === "lesson_card" ? [e.card] : []));

describe("lesson-card catalog", () => {
  test("defines only components named in CATALOG_COMPONENTS", () => {
    for (const name of Object.keys(lessonCardComponentDefinitions)) expect(CATALOG_COMPONENTS).toContain(name);
  });

  test("the demo fixture's cards match their catalog props", () => {
    const checked = cards.flatMap((card) => {
      const root = card.elements[card.root]!;
      const definition = lessonCardComponentDefinitions[root.type as keyof typeof lessonCardComponentDefinitions];
      if (!definition) return [];
      expect(definition.props.safeParse(root.props).error).toBeUndefined();
      return [root.type];
    });
    expect(new Set(checked)).toEqual(new Set(["OfferCard", "ProbeCard", "DataFlowDiagram", "ArticulationCard"]));
  });

  test("rejects a card with missing props", () => {
    expect(probeCardSchema.safeParse({ lessonId: "l1" }).success).toBe(false);
  });

  test.each([
    ["Node.js can run server code. A 0.5-second delay can make a retry visible.", true],
    ["Node.js can run server code. A delay can make a retry visible. The client can retry.", false],
    ["客户端可以重试。短暂等待可以减少重复请求。", true],
    ["客户端可以重试。短暂等待可以减少重复请求。服务器也可以限流。", false],
  ])("validates the two-sentence background limit for %s", (background, success) => {
    expect(textExplanationSchema.safeParse({
      title: "Request retries",
      text: "The client retries a failed request on line 3.",
      citations: [{ path: "app.js", startLine: 3 }],
      background,
    }).success).toBe(success);
  });
});
