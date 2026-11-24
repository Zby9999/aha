import { createTimeline, type NewTimelineEntry } from "@aha/contracts";
import { expect, test } from "vitest";
import { createStubDecisions } from "../src/index.ts";

// Seam: DecisionService.detectImpasse of the stub.

function timelineOf(entries: NewTimelineEntry[]) {
  const timeline = createTimeline({ sessionId: "s" });
  for (const entry of entries) timeline.append(entry);
  return timeline.entries();
}

const error = (origin: "agent" | "tool" | "project", message: string): NewTimelineEntry => ({ kind: "error", source: "agent-host", origin, message });

test("the same project error twice is an Impasse", async () => {
  const detection = await createStubDecisions().detectImpasse({
    timeline: timelineOf([error("project", "GET /api/me 401 (Unauthorized)"), error("project", "GET /api/me 401 (Unauthorized)")]),
  });
  expect(detection?.impasse).toMatchObject({ trigger: "detected", sourceEntryIds: ["s:0", "s:1"] });
});

test.each(["agent", "tool"] as const)("the same %s error twice is not an Impasse", async (origin) => {
  const detection = await createStubDecisions().detectImpasse({
    timeline: timelineOf([error(origin, "The active page became unverified"), error(origin, "The active page became unverified")]),
  });
  expect(detection).toBeNull();
});

test("agent errors between them do not hide a repeated project error", async () => {
  const detection = await createStubDecisions().detectImpasse({
    timeline: timelineOf([error("project", "401"), error("tool", "x"), error("tool", "x"), error("project", "401"), error("tool", "y")]),
  });
  expect(detection?.impasse.sourceEntryIds).toEqual(["s:0", "s:3"]);
});
