import { lessonCardComponentDefinitions } from "@aha/contracts";
import { card, lessonGalleryFixtures, portfolioSessionFlow } from "@aha/contracts/fixtures";
import { expect, test } from "vitest";
import { parseLessonCard } from "../ui/cards/catalog.ts";

test("the render catalog accepts the portfolio diagram and rejects malformed cards", () => {
  const diagram = card("DataFlowDiagram", portfolioSessionFlow);
  expect(parseLessonCard(diagram)).toBeDefined();
  expect(parseLessonCard(card("ProbeCard", { lessonId: "lesson-1" }))).toBeUndefined();
  expect(parseLessonCard({ ...diagram, root: "missing" })).toBeUndefined();
  expect(parseLessonCard({ ...diagram, elements: { card: { ...diagram.elements.card!, children: ["card"] } } })).toBeUndefined();
  expect(parseLessonCard(card("DataFlowDiagram", {
    ...portfolioSessionFlow,
    edges: [{ from: "refresh", to: "missing", label: "Runs app.js again" }],
  }))).toBeUndefined();
  expect(parseLessonCard(card("DataFlowDiagram", {
    ...portfolioSessionFlow,
    citations: [{ path: "server.js", startLine: 42, endLine: 38 }],
  }))).toBeUndefined();
});

test("the render catalog accepts a cited decision flow and rejects an unnamed branch", () => {
  const flow = {
    title: "Where does the request end?",
    steps: ["Request account data"],
    decision: {
      question: "Is there a session?",
      branches: [{ label: "Yes", steps: ["Show portfolio"] }, { label: "No", steps: ["Show login"] }],
    },
    citations: [{ path: "server.js", startLine: 38, endLine: 43 }],
  };
  expect(parseLessonCard(card("Flowchart", flow))).toBeDefined();
  expect(parseLessonCard(card("Flowchart", {
    ...flow,
    decision: { ...flow.decision, branches: [{ label: " ", steps: ["Show login"] }, flow.decision.branches[0]] },
  }))).toBeUndefined();
});

test("the gallery covers the renderable catalog with valid fixture specs", () => {
  expect(Object.keys(lessonGalleryFixtures).sort()).toEqual(Object.keys(lessonCardComponentDefinitions).sort());
  for (const [name, fixture] of Object.entries(lessonGalleryFixtures)) {
    expect(fixture.elements[fixture.root]?.type).toBe(name);
    expect(parseLessonCard(fixture), name).toBeDefined();
  }
});

test("sequence render props use validated participant IDs and distinguish actors", () => {
  const sequence = lessonGalleryFixtures.SequenceDiagram.elements.card!.props;
  const parsed = parseLessonCard(card("SequenceDiagram", {
    ...sequence,
    participants: [{ id: " browser ", label: "Browser" }, { id: "server", label: "Server" }],
  }));
  expect(parsed?.elements.card?.props).toMatchObject({ participants: [{ id: "browser" }, { id: "server" }] });
  expect(parseLessonCard(card("SequenceDiagram", {
    ...sequence,
    messages: [{ from: "browser", to: "missing", label: "Send request" }],
  }))).toBeUndefined();
  expect(parseLessonCard(card("SequenceDiagram", {
    ...sequence,
    participants: [{ id: "browser", label: "App" }, { id: "server", label: "App" }],
  }))).toBeUndefined();
});
