import { DEMO_CONCEPTS } from "@aha/contracts/fixtures";
import { createDecisions, jevConfig, type DecisionOptions } from "../src/index.ts";
import { examples } from "./examples.ts";

const config = jevConfig(process.env);
if (!config.apiKey?.trim()) throw new Error("Configure the Jev API key in the environment or repository .env.local.");
const concepts = [
  { id: DEMO_CONCEPTS.sessionToken, name: "Session tokens", mastery: "not_encountered" as const },
  { id: DEMO_CONCEPTS.pageReload, name: "Page refresh resets state", mastery: "not_encountered" as const },
];

async function measure(expected: boolean, run: (options: DecisionOptions) => Promise<boolean>) {
  let failure: string | undefined;
  const start = performance.now();
  const result = await run({ ...config, onFailure: (reason) => { failure = reason; } });
  return { expected, actual: failure ? null : result, failure, correct: !failure && result === expected,
    latencyMs: Math.round(performance.now() - start) };
}

const rows = [];
for (const { name, timeline, impasse, evidence } of examples) {
  const entry = timeline.at(-1)!;
  const [detection, write] = await Promise.all([
    measure(impasse, async (options) => (await createDecisions(options).detectImpasse({ timeline })) !== null),
    measure(evidence, async (options) => {
      const decisions = await createDecisions(options).gateEvidence({ timeline, newEntries: [entry], concepts });
      return (decisions?.length ?? 0) > 0;
    }),
  ]);
  const row = { name, detectImpasse: detection, gateEvidence: write };
  rows.push(row);
  console.log(JSON.stringify(row));
}
for (const question of ["detectImpasse", "gateEvidence"] as const) {
  const answers = rows.map((row) => row[question]);
  const valid = answers.filter(({ actual }) => actual !== null);
  const correct = valid.filter((answer) => answer.correct).length;
  console.log(JSON.stringify({ question, cases: answers.length, unavailable: answers.length - valid.length,
    coverage: valid.length / answers.length, accuracyOnAvailable: valid.length ? correct / valid.length : null,
    accuracyOnAll: correct / answers.length, meanLatencyMs: answers.reduce((sum, a) => sum + a.latencyMs, 0) / answers.length }));
  if (valid.length !== answers.length) process.exitCode = 1;
}
