import { DEMO_CONCEPTS, demoSession } from "@aha/contracts/fixtures";
import { createDecisions } from "../src/index.ts";

if (!process.env.JEV_API_KEY?.trim()) {
  throw new Error("Set JEV_API_KEY or pass --env-file=.env.local to Node.");
}

const decisions = createDecisions();
const firstError = demoSession.findIndex((entry) => entry.kind === "error");
const secondError = demoSession.findIndex((entry, index) => index > firstError && entry.kind === "error");
if (firstError < 0 || secondError < 0) throw new Error("Expected two errors in the demo recording.");

const cases = [
  { end: firstError, impasse: false, evidence: false },
  { end: secondError, impasse: true, evidence: true },
];
const concepts = [
  { id: DEMO_CONCEPTS.sessionToken, name: "Session tokens", mastery: "not_encountered" as const },
  { id: DEMO_CONCEPTS.pageReload, name: "Page refresh resets state", mastery: "not_encountered" as const },
];

let impasseCorrect = 0;
let evidenceCorrect = 0;
for (const sample of cases) {
  const timeline = demoSession.slice(0, sample.end + 1);
  const userEvent = timeline.findLast((entry) => entry.kind === "user_message");
  if (!userEvent) throw new Error("Expected a user message in the demo recording.");
  const start = performance.now();
  const [impasse, evidence] = await Promise.all([
    decisions.detectImpasse({ timeline }),
    decisions.gateEvidence({ timeline, newEntries: [userEvent], concepts }),
  ]);
  const detected = impasse !== null;
  const recorded = (evidence?.length ?? 0) > 0;
  impasseCorrect += Number(detected === sample.impasse);
  evidenceCorrect += Number(evidence !== null && recorded === sample.evidence);
  console.log(JSON.stringify({
    entryId: timeline.at(-1)?.id, latencyMs: Math.round(performance.now() - start),
    actual: { impasse: detected, evidence: evidence === null ? "unavailable" : recorded },
    expected: { impasse: sample.impasse, evidence: sample.evidence },
  }));
}
console.log(JSON.stringify({ cases: cases.length, impasseAccuracy: impasseCorrect / cases.length,
  evidenceAccuracy: evidenceCorrect / cases.length }));
