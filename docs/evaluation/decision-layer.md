# Decision Layer evaluation (Jev)

Technical evaluation of the Decision Layer (`packages/decisions`) against the live Jev endpoint, run on 2026-11-25. It measures the three decisions that use Jev — `detectImpasse` (Offers), `gateEvidence` (the write gate) and `selectConcepts` (the read gate) — for accuracy, run-to-run consistency and latency.

Reproduce with a Jev key in `.env.local`:

```bash
pnpm --filter @aha/decisions evaluate:full
```

`EVAL_REPEATS` (default 3) and `EVAL_OUT` (a JSON file for every run and the summary) adjust the run. The labeled cases are in `packages/decisions/scripts/eval-cases.ts`; the raw results of the latest run (after both fixes below) are in [`decision-layer-results.json`](decision-layer-results.json).

## Method

- **Cases.** 51 labeled cases, written and labeled for this evaluation before the run: 24 for `detectImpasse` (12 positive, 12 negative), 15 for `gateEvidence` (9 with Evidence, 6 without) and 12 for `selectConcepts`. They cover the demo scenario and seven other beginner topics (async fetch, CSS layout, environment variables, password hashing, form submission, JSON parsing, IDs), Chinese and mixed-language messages, prompt injection, resolved questions, follow-ups and routine requests.
- **Realistic inputs.** Every `detectImpasse` case has two gap events in separate turns, so Jev is always asked. `gateEvidence` and `selectConcepts` get the Learner Model's full seed catalog (35 Concepts), so they run in batches as they do live.
- **Repeats.** Each case ran 3 times (153 decisions, 276 Jev calls). Consistency is the share of cases whose 3 runs gave the same answer.
- **Latency.** The production client times out after 1.5 s. The evaluation raised the timeout to 10 s so slow answers would be measured instead of cut off, and counts how many calls would have exceeded 1.5 s.
- **Labels.** `gateEvidence` cases list every seed Concept a careful labeler would accept; `selectConcepts` cases list the Concepts that must be hit (at least one) and the wider set that counts as relevant.

## Results

### Accuracy

| Decision | Measure | Result |
|---|---|---|
| `detectImpasse` | accuracy (72 runs) | **95.8%** |
| | precision / recall / F1 | 92.3% / **100%** / 0.96 |
| | consistency across repeats | 100% |
| `gateEvidence` | write or not (any Evidence vs none) | **100%** (0 false writes, 0 missed) |
| | Evidence type correct | 88.9% |
| | Concept correct, when written | **77.8%** |
| | outcome correct, when written | 88.9% |
| | consistency across repeats | 100% |
| `selectConcepts` | hit rate (a required Concept selected) | 91.7% |
| | precision of selected Concepts | **68.7%** (3.2 selected on average) |
| | empty selections | 8.3% |
| | consistency across repeats | **50%** |

### Latency

| Decision | Jev calls per decision | Decision p50 / p95 / max | Calls over 1.5 s |
|---|---|---|---|
| `detectImpasse` | 1 | 205 / 329 / 617 ms | 0 of 72 |
| `gateEvidence` (35 Concepts) | 2.9 | 418 / 488 / 526 ms | 0 of 132 |
| `selectConcepts` (35 Concepts) | 2 (parallel) | 210 / 421 / 452 ms | 0 of 72 |

A single Jev call took 200 ms at the median and 615 ms at worst. No call came near the 1.5 s production timeout, so Jev adds well under half a second to a turn and does not slow the agent: detection and the write gate run beside the agent turn, and the read gate runs once when a Lesson starts.

## Findings

1. **Offers are reliable.** `detectImpasse` found every recurring gap (36/36), including paraphrases, Chinese, mixed Chinese-English, a gap with an unrelated turn in between, and repeated project errors. It ignored resolved questions, follow-up questions, same-topic-but-different gaps, routine requests, praise and a prompt injection that told it to answer yes. Its answers did not change across repeats.
2. **One false Offer type: environment failures.** Two identical `npm ERR! … ETIMEDOUT` errors were judged a recurring understanding gap in all 3 runs. Live, Aha would offer a Lesson about a network outage. A filter for errors that are not about the user's code (network, install, missing tool) before asking Jev would remove it.
3. **The write gate never writes when it should not.** Self-reports ("I totally understand promises now"), thanks, routine requests, plain questions and an injection asking to be classified as `independent_fix` produced no Evidence in any run. Every real behaviour produced Evidence. This matters most: wrong Evidence would corrupt the Learner Model.
4. **Generic Concepts absorb Evidence.** In 2 of 9 Evidence cases, all 3 runs filed the Evidence under `debugging` instead of the specific Concept: catching a wrong password-hash comparison went to `debugging`, not `password-hashing`; judging that try/catch hides a missing token header went to `debugging`, not `request-headers` or `session-tokens`. The batched concept choice (best of each group of 20, then best of the winners) lets a broad Concept win the final round.
5. **The read gate over-selects and varies.** It nearly always finds the right Concept, but adds about one unrelated Concept per Impasse — mostly `debugging` (12 times) and `client-server` (11) — and returns a different set in half of the cases across runs. It found nothing for a question about HTML in a description rendering as markup (`output-escaping`).
6. **Findings 4 and 5 compound into wrong adaptation.** `lessonFormat` adapts to the selected Concepts the learner has already met. If Evidence lands on `debugging` (finding 4) and the read gate then adds `debugging` to an unrelated Impasse (finding 5), the learner gets the short hint format for a topic they have never seen. Example: after the hash-comparison Evidence, *"Why does clicking Add reload the whole page?"* selects `debugging`, `dom-events` and `form-submission`; only `debugging` is met, so the Lesson would be a single hint card. Suggested fix: keep cross-cutting Concepts such as `debugging` out of Evidence and selection, or ask Jev for the most specific Concept.
7. **Evidence type is mostly right; one case is ambiguous.** "Hard-coding the key makes it work, but it would end up on GitHub" was labeled `fix_judgement` and classified `caught_agent_mistake` in every run. Both readings are defensible, so this is a labeling ambiguity rather than an error.
8. **The original 9-case evaluation overstated detection.** In `pnpm --filter @aha/decisions evaluate`, 6 of the 9 `detectImpasse` cases contain a single gap event and return before Jev is asked (0 ms), so its 9/9 says little about Jev. The extended set asks Jev in every case.

## Fix and re-run

Findings 4–6 were fixed in the Decision Layer, then the same 51 cases were run again (3 repeats):

- The concept questions of the write gate and the read gate now ask for the Concept whose subject matter the behaviour or question is about; a general practice such as debugging, testing or version control fits only when it is itself the topic.
- `caught_agent_mistake` and `independent_fix` Evidence is always positive, as `repeated_gap` was already always negative. Jev had read "the agent's code has a mistake" as a gap and marked two caught mistakes negative, which would have lowered the learner's mastery for spotting the bug.

| Measure | Before | After |
|---|---|---|
| `gateEvidence` Concept correct, when written | 77.8% | **100%** |
| `gateEvidence` outcome correct, when written | 88.9% | **100%** |
| `gateEvidence` consistency | 100% | 100% |
| `selectConcepts` hit rate | 91.7% | 94.4% |
| `selectConcepts` precision | 68.7% | 73.0% |
| `selectConcepts` Concepts selected on average | 3.2 | 2.5 |
| `selectConcepts` consistency | 50% | 75% |
| `debugging` selected outside the relevant set | 12 times | **0** |
| `detectImpasse` accuracy | 95.8% | 95.8% (unchanged) |

The compounding case in finding 6 no longer happens: *"Why does clicking Add reload the whole page?"* now selects `dom-events` and `form-submission` (once also `page-reload-resets-state`), not `debugging`. Latency is unchanged (call p50 190 ms, max 520 ms, none over 1.5 s). Still open: the environment-failure Offer (finding 2), one remaining miss on the HTML-escaping question (2 of 3 runs empty), and the read gate still adds `client-server` or `rendering-state` to some Impasses.

## Second fix and re-run

The three issues left open above were fixed next, and the case set grew to 61: one more environment failure for `detectImpasse` (`command not found: node` twice), and 9 more `selectConcepts` cases — 4 questions no seed Concept fits (CSS layout, centring, a blurry image, fonts), where nothing should be selected, and 5 **held-out** cases written after the thresholds below were chosen.

- **Environment failures.** The recurrence question now says that failures of the environment rather than the user's code (network or registry errors, a missing tool, a full disk) are not understanding gaps.
- **Read-gate selection.** Instead of every Concept scoring at least 0.7, the read gate keeps the best-scoring Concept if it reaches 0.65, plus at most one more Concept that reaches 0.7. Raw scores showed why: almost every Concept relates to a web question somewhat, so a flat threshold let neighbours such as `client-server` in, while the HTML-escaping question's one right Concept hovered around 0.7 and was sometimes dropped. When one fitted, the best Concept scored at least 0.66; when none fitted, at most 0.60. The 0.65 floor sits in that gap, which is narrow; the held-out cases check it.

| Measure | After first fix | After second fix |
|---|---|---|
| `detectImpasse` accuracy | 95.8% | **100%** (75 runs, incl. both environment failures) |
| `detectImpasse` recall | 100% | 100% |
| `selectConcepts` hit rate | 94.4% | **97.8%** |
| `selectConcepts` precision | 73.0% | **93.2%** |
| `selectConcepts` empty when a Concept fits | 5.6% | **0%** |
| `selectConcepts` Concepts selected on average | 2.5 | 1.6 |
| `selectConcepts` selection when no Concept fits | not measured | **0%** |
| Held-out cases: hit rate / selection when none fits | — | 100% / 0% |
| `selectConcepts` consistency | 75% | 76% |
| `gateEvidence` | unchanged | Concept 100%, outcome 100%, write/no-write 100% |

The one remaining read-gate miss: in 1 of 3 runs, *"Why does clicking Add reload the whole page?"* selected `page-reload-resets-state` and `dom-events` but not `form-submission`. Both selected Concepts are relevant, so the Lesson still fits. The `fix_judgement` / `caught_agent_mistake` ambiguity (finding 7) is a labeling question and was left as is. Latency is unchanged: call p50 under 200 ms, max 406 ms, none over 1.5 s.

## Limitations

- The cases are synthetic and short, labeled by their authors, and the set is small (51 cases). The results show behaviour on clear-cut inputs, not accuracy on real learner sessions; a real session study is out of scope (see #1).
- Jev's answers were deterministic for detection and the write gate, so three repeats measure stability, not sampling variance.
- Latency was measured from one network location on one day.
