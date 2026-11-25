// Extended Decision Layer evaluation against live Jev: accuracy, run-to-run consistency and latency of
// detectImpasse, gateEvidence and selectConcepts on the labeled cases in eval-cases.ts.
//
//   pnpm --filter @aha/decisions evaluate:full
//
// EVAL_REPEATS (default 3) runs every case that many times. EVAL_TIMEOUT_MS (default 10000) replaces the 1.5 s
// production timeout, so slow answers are measured rather than cut off; the report shows how many calls would
// have exceeded the production timeout. EVAL_OUT writes every run and the summary as JSON.
import { writeFileSync } from "node:fs";
import type { Impasse } from "@aha/contracts";
import { createDecisions, jevConfig, type DecisionOptions } from "../src/index.ts";
import { CONCEPT_CASES, EVIDENCE_CASES, IMPASSE_CASES, SEED_CATALOG } from "./eval-cases.ts";

const PRODUCTION_TIMEOUT_MS = 1500; // createJevClient's default
const repeats = Number(process.env.EVAL_REPEATS ?? 3);
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS ?? 10_000);

const config = jevConfig(process.env);
if (!config.apiKey?.trim()) throw new Error("Configure the Jev API key in the environment or repository .env.local.");

type Fn = "detectImpasse" | "gateEvidence" | "selectConcepts";
const callLatencies: Record<Fn, number[]> = { detectImpasse: [], gateEvidence: [], selectConcepts: [] };

/** Runs one decision with a fresh client, timing the whole decision and every Jev call it makes. */
async function timed<T>(fn: Fn, run: (decisions: ReturnType<typeof createDecisions>) => Promise<T>) {
  let calls = 0;
  let failure: string | undefined;
  const fetchTimed: typeof fetch = async (...args) => {
    calls++;
    const start = performance.now();
    try {
      return await fetch(...args);
    } finally {
      callLatencies[fn].push(performance.now() - start);
    }
  };
  const options: DecisionOptions = { ...config, timeoutMs, fetch: fetchTimed, onFailure: (reason) => { failure ??= reason; } };
  const start = performance.now();
  const result = await run(createDecisions(options));
  return { result, failure, calls, latencyMs: Math.round(performance.now() - start) };
}

const runs: Record<string, unknown>[] = [];
const log = (row: Record<string, unknown>) => { runs.push(row); console.log(JSON.stringify(row)); };

for (let r = 0; r < repeats; r++) {
  for (const c of IMPASSE_CASES) {
    const { result, ...meta } = await timed("detectImpasse", (d) => d.detectImpasse({ timeline: c.timeline }));
    log({ fn: "detectImpasse", case: c.name, repeat: r, expected: c.expected, actual: meta.failure ? null : result !== null, ...meta });
  }
  for (const c of EVIDENCE_CASES) {
    const { result, ...meta } = await timed("gateEvidence", (d) =>
      d.gateEvidence({ timeline: c.timeline, newEntries: [c.timeline.at(-1)!], concepts: SEED_CATALOG }));
    const first = result?.[0];
    log({ fn: "gateEvidence", case: c.name, repeat: r, expected: { kind: c.kind, outcome: c.outcome, concepts: c.concepts },
      actual: result === null ? null : { kind: first?.type ?? "none", outcome: first?.outcome, concept: first?.conceptId, count: result.length },
      ...meta });
  }
  for (const c of CONCEPT_CASES) {
    const impasse: Impasse = { id: c.name, trigger: "ask_why", title: c.text, text: c.text, conceptIds: [], sourceEntryIds: [] };
    const { result, ...meta } = await timed("selectConcepts", (d) => d.selectConcepts({ impasse, concepts: SEED_CATALOG }));
    log({ fn: "selectConcepts", case: c.name, repeat: r, expected: { expect: c.expect, allowed: c.allowed }, actual: result, ...meta });
  }
}

// ---------------------------------------------------------------- summary

const of = (fn: Fn) => runs.filter((row) => row.fn === fn) as any[];
const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null);
const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!);
};
/** Share of cases whose repeats all gave the same answer. */
const consistency = (rows: any[], key: (row: any) => string) => {
  const byCase = new Map<string, Set<string>>();
  for (const row of rows) byCase.set(row.case, (byCase.get(row.case) ?? new Set()).add(key(row)));
  return ratio([...byCase.values()].filter((answers) => answers.size === 1).length, byCase.size);
};
function latency(fn: Fn) {
  const rows = of(fn);
  const decisions = rows.filter((row) => row.calls > 0).map((row) => row.latencyMs);
  const calls = callLatencies[fn];
  return {
    decisionsCallingJev: decisions.length, decisionsShortCircuited: rows.length - decisions.length,
    meanCallsPerDecision: ratio(rows.reduce((sum, row) => sum + row.calls, 0), rows.length),
    decisionP50: percentile(decisions, 50), decisionP95: percentile(decisions, 95), decisionMax: percentile(decisions, 100),
    callP50: percentile(calls, 50), callP95: percentile(calls, 95), callMax: percentile(calls, 100),
    callsOverProductionTimeout: calls.filter((ms) => ms > PRODUCTION_TIMEOUT_MS).length, calls: calls.length,
  };
}

const detect = of("detectImpasse");
const detectValid = detect.filter((row) => row.actual !== null);
const count = (pred: (row: any) => boolean) => detectValid.filter(pred).length;
const tp = count((row) => row.expected && row.actual), fp = count((row) => !row.expected && row.actual);
const fn = count((row) => row.expected && !row.actual), tn = count((row) => !row.expected && !row.actual);

const gate = of("gateEvidence");
const gateValid = gate.filter((row) => row.actual !== null);
const gatePositive = gateValid.filter((row) => row.expected.kind !== "none");
const gateWritten = gatePositive.filter((row) => row.actual.kind !== "none");

const select = of("selectConcepts");
const selectValid = select.filter((row) => row.actual !== null);
const selected = selectValid.flatMap((row) => row.actual.map((id: string) => row.expected.allowed.includes(id)));

const summary = {
  meta: { repeats, timeoutMs, productionTimeoutMs: PRODUCTION_TIMEOUT_MS, catalogSize: SEED_CATALOG.length,
    cases: { detectImpasse: IMPASSE_CASES.length, gateEvidence: EVIDENCE_CASES.length, selectConcepts: CONCEPT_CASES.length } },
  detectImpasse: {
    runs: detect.length, unavailable: detect.length - detectValid.length, tp, fp, fn, tn,
    accuracy: ratio(tp + tn, detectValid.length), precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn),
    f1: ratio(2 * tp, 2 * tp + fp + fn), consistency: consistency(detect, (row) => String(row.actual)),
    errors: detectValid.filter((row) => row.expected !== row.actual).map((row) => `${row.case}#${row.repeat}`),
    latency: latency("detectImpasse"),
  },
  gateEvidence: {
    runs: gate.length, unavailable: gate.length - gateValid.length,
    writeAccuracy: ratio(gateValid.filter((row) => (row.expected.kind === "none") === (row.actual.kind === "none")).length, gateValid.length),
    falseWriteRate: ratio(gateValid.filter((row) => row.expected.kind === "none" && row.actual.kind !== "none").length,
      gateValid.filter((row) => row.expected.kind === "none").length),
    missedWriteRate: ratio(gatePositive.length - gateWritten.length, gatePositive.length),
    kindAccuracy: ratio(gatePositive.filter((row) => row.actual.kind === row.expected.kind).length, gatePositive.length),
    conceptAccuracyWhenWritten: ratio(gateWritten.filter((row) => row.expected.concepts.includes(row.actual.concept)).length, gateWritten.length),
    outcomeAccuracyWhenWritten: ratio(gateWritten.filter((row) => row.actual.outcome === row.expected.outcome).length, gateWritten.length),
    consistency: consistency(gate, (row) => JSON.stringify(row.actual)),
    errors: gateValid.filter((row) => row.actual.kind !== row.expected.kind
      || (row.actual.kind !== "none" && !row.expected.concepts.includes(row.actual.concept)))
      .map((row) => `${row.case}#${row.repeat}: ${row.actual.kind}/${row.actual.concept ?? "-"}`),
    latency: latency("gateEvidence"),
  },
  selectConcepts: {
    runs: select.length, unavailable: select.length - selectValid.length,
    hitRate: ratio(selectValid.filter((row) => row.actual.some((id: string) => row.expected.expect.includes(id))).length, selectValid.length),
    precision: ratio(selected.filter(Boolean).length, selected.length),
    emptyRate: ratio(selectValid.filter((row) => row.actual.length === 0).length, selectValid.length),
    meanSelected: ratio(selected.length, selectValid.length),
    consistency: consistency(select, (row) => JSON.stringify([...(row.actual ?? [])].sort())),
    misses: selectValid.filter((row) => !row.actual.some((id: string) => row.expected.expect.includes(id)))
      .map((row) => `${row.case}#${row.repeat}: [${row.actual.join(", ")}]`),
    latency: latency("selectConcepts"),
  },
};
console.log(JSON.stringify(summary, null, 2));
if (process.env.EVAL_OUT) writeFileSync(process.env.EVAL_OUT, `${JSON.stringify({ summary, runs }, null, 2)}\n`);
