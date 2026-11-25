# Learning scenarios beyond the scripted demo

A live evaluation of whether Aha's learning loop works outside `docs/demo.md`. Run on 2026-11-25 with every module real: the user's own Pi (RPC), Jev decisions, the Markdown Learner Model, generated Teaching and the background Pi. `AHA_DREAM_IDLE_MS=30000`.

Three sessions, each on a fresh copy of `examples/portfolio` with an empty Learner Model:

- **Run A**: `/tmp/aha-eval-a`, Aha on port 4471, preview on 4472. Scenarios S1–S6, then Ctrl-C (SIGINT).
- **Run B**: `/tmp/aha-eval-b`, Aha on port 4481, preview on 4482. Scenarios S7–S8, then SIGINT.
- **Run C**: `/tmp/aha-eval-c`, Aha on port 4491, preview on 4492. S9, one long and complex session of 12 steps, then SIGINT.

Every step was driven through the web UI in a browser. Timings come from the `at` timestamps of Timeline entries, recorded by a WebSocket listener. The Evidence and mastery shown are the files under `<project>/.aha/learner-model/`.

The Decision Layer read gate runs as it is on `main`: open PRs #75–#77, which limit it to at most 2 Concepts, are **not** included. Findings that depend on concept selection are marked *(read gate)*.

## Scenarios and outcomes

**Length** is the number of user turns: short is 1–2 turns, long is 8 or more turns in one session. **Complexity**: *simple* is one file and one concept; *complex* is a change across several files, or an Impasse that involves 2–3 concepts.

| # | Length | Complexity | Scenario (what varies) | Trigger | What Aha showed | Learner Model result | Verdict |
|---|---|---|---|---|---|---|---|
| S1 | short (1) | simple | Pure work turn: change the page subtitle | none | Nothing: no Impasse, no Offer, no card | No Evidence | ✅ as intended |
| S2 | short (1 + Why) | simple (1 file) | Password hashing (new concept); a learner who answers correctly | Why? on the `server.js` change | Probe → Explain (text, grounded) → Articulation, assessed **correct** | `password-hashing`: Evidence ev-1 (positive), then idle Dreaming made it `not_encountered → correct_with_hints` | ✅ |
| S3 | short (1) | simple | The same concept after S2's mastery change ("why a salt?") | Ask why | An adapted lesson: one hint card, completed at once | No Evidence | ⚠️ The format adapted, but the question was never answered (P1-7) |
| S4 | short (1) | simple | Environment variables; the question is in **Chinese**; the learner says "我不知道", then gives a **wrong** Articulation | Ask why (Chinese) | Probe in English → Explain in Chinese → Articulation, assessed **incorrect** | `environment-variables`: ev-2 (negative); mastery stays `not_encountered` | ⚠️ The assessment was right, but the learner never sees it (P1-1); there is a language mix (P2-1) |
| S5 | short (2) | simple (1 file) | **Repeated confusion**: data lost after a restart, twice; persistence to a file | detected (Jev) | **Offer** 5.5 s after the second message → Probe → wrong prediction → Explain (DataFlowDiagram that corrects it) → Articulation, assessed **correct** | `database-persistence`: ev-3 and ev-4 (`repeated_gap`, duplicates), ev-5 (positive), then `→ correct_with_hints` | ✅ the loop works; P2 quality issues |
| S6 | short (1 + Why) | simple | **Advanced learner** catches a real bug in the agent's `loadData` | work message, then Why? on the fix | No lesson on the message. Why? afterwards gave a full Probe on an obscure edge case; Back to work ended it cleanly | ev-6: `caught_agent_mistake`, strong, on **`debugging`**, so `debugging: not_encountered → catches_agent_mistakes` from one message | ❌ wrong concept and a one-shot jump to the top level (P1-3) |
| S7 | short (1) | simple | Fetch error with the server stopped; there is **no agent change**; the learner says "I don't know" twice and asks a follow-up | Ask why | Probe → Explain → a follow-up question answered with grounding → the Articulation "I don't know, I'm still confused" ends the lesson as **completed** | No Evidence (assessed unclear) | ⚠️ the confused learner is dropped (P1-2) |
| S8 | short (1 + Why) | simple (1 file, 1 concept) | Form validation (empty title); a **work request typed during a Lesson** | Why? on the `server.js` change | The request was silently not sent, then became a Lesson question that Pi never saw, and the answer gave away the Probe. The rest of the lesson was assessed **correct** | `input-validation`: ev-1, then SIGINT Dreaming made it `→ correct_with_hints` | ⚠️ learning blocks work (P1-6) |
| S9 | **long (12 steps)** | **complex**: changes across 2–5 files, a new data file, one 3-concept question | Mixed work and learning: 4 work turns, 4 Lessons (Why ×2, Ask why ×2), a follow-up inside a Lesson, idle Dreaming twice in the middle, SIGINT at the end. Details in the next section | Why?, Ask why | Grounded cross-file diagrams. The later Ask why on session tokens adapted to a one-card hint. The 3-concept question was cut down to one case | `session-tokens` and `authorization` both went to `correct_with_hints`; no duplicate or contradictory concepts | ⚠️ the loop holds over a long session; complex questions and answers lose detail (P1-8, P1-9, P2-10) |

### S9: one long, complex session (run C)

| Step | User action | What happened | Lesson step latency |
|---|---|---|---|
| 1 | Work: *after refresh I'm logged out and projects are gone; same after logout/login. Fix both* | Pi edited `server.js` and `public/app.js` (the seeded bug) | — |
| 2 | Why? on `public/app.js` → prediction (right) | Probe cites `app.js` 1–4, 92–95, 130–138. Explain is a **DataFlowDiagram across `app.js` and `server.js`** (localStorage → header → `getSession` → `/api/me` → render). Every cited line checked out | Why → Probe 2.8 s; Explain 13.8 s |
| 3 | Follow-up in the Lesson: *Is localStorage safe? Could another website read my token?* | The answer **ignored the question** and re-explained the fix (P1-7) | 4.0 s |
| 4 | Articulation covering tokens, localStorage and per-user projects | Assessed correct, but **only `session-tokens`** was credited (P2-10) | 8.6 s |
| 5 | Work: *save projects in a new file `data/projects.json` and show a "Saved" note* | Pi changed **5 files** (`server.js` ×2, `index.html`, `style.css`, `app.js`, `README.md`). **Idle Dreaming** in the middle: `session-tokens → correct_with_hints` | — |
| 6 | Ask why (3 concepts): *Why did my projects disappear in three ways before — refresh, logout, restart? Same problem?* | Full lesson. The Probe asked only about logout in the *current* code. The Explain diagram covered only logout; refresh, restart and "before" were dropped (P1-8). The format stayed full although `session-tokens` was already mastered *(read gate)* | Probe 4.9 s; Explain 8.5 s |
| 7 | A three-cause Articulation that is correct and complete | **No assessment, no Evidence**: the lesson ended at exactly +10.0 s, the assessor's deadline (P1-9) | 10.0 s (timeout) |
| 8 | Work: *add a Delete button; only the owner may delete* | Pi changed `server.js`, `app.js` and `style.css` ×3, and wrote `README.md` | — |
| 9 | Why? on the `server.js` delete change → prediction → Articulation about ownership | Full lesson, diagram across both files, assessed correct on **`authorization`** | Probe 3.6 s; Explain 7.7 s; assessment 4.0 s |
| 10 | Ask why: *Why does every request need the X-Session-Token header, even Delete?* | **Adapted**: one hint card that cites `app.js` 23–28 and `server.js` 63–66 and 125–135, then completes | 2.0 s |
| 11 | Work (simple): *rename Delete to Remove* | A one-line `app.js` edit; no Impasse, no Offer | — |
| 12 | Idle, then SIGINT | Idle Dreaming: `authorization → correct_with_hints`; SIGINT exited in 20 s; no orphan processes this run | — |

Steps 1, 5, 8 and 11 are work turns, steps 3, 6 and 10 are typed questions, and the rest are answers to lesson cards. That makes 12 user inputs in one session, 7 of them typed into the composer.

What the long session shows:

- **Latency did not degrade.** Why → Probe took 2.8 s at Timeline seq 314 and 3.6 s at seq 1099, and the hint took 2.0 s at seq 1108. All lesson steps stayed under 14 s except the assessor timeout.
- **The Timeline grows fast, but the UI held.** About 1,120 entries and 737 KB of WebSocket traffic in 12 steps, mostly Pi tool calls. The page had 2,680 DOM nodes, a 41 MB JS heap and a 10 ms layout, with no visible slowdown. Finding the right change got hard, though: there were **15 Why? buttons**, four of them on `Edited server.js` cards that look the same (P2-11).
- **Adaptation within the session works for direct questions.** After `session-tokens` was mastered in turn 2, the Ask why in turn 10 got a hint. A Why? on a change involving the same concept (turn 9) and the 3-concept question (turn 6) still got full lessons *(read gate)*.
- **The Learner Model stayed consistent.** 2 concepts, 2 Evidence entries, no duplicates or contradictions. `changelog.md` reads in order: one empty idle section, then the two promotions. But it **under-credits**: `browser-storage`, `data-belongs-to-user` and `database-persistence` were each explained correctly in an Articulation and are still `not_encountered` (P1-9, P2-10).
- **The cross-file complexity was handled well.** Every Explain diagram stayed grounded across `public/app.js` and `server.js`, with 4–5 nodes, and none was too long. Complexity hurt in the *question* (cut to one case) and in the *answer* (assessment timeout, one concept per answer), not in the explanation.

Lifecycle checks:

| Check | Result |
|---|---|
| Idle Dreaming | Fired every time, 30–60 s after the last activity. Mastery changes appeared in `changelog.md` and the concept files. |
| SIGINT Dreaming | Run A exited in 6 s. Run B exited in 18 s and applied a pending change (`input-validation`) that idle Dreaming had not reached yet. |
| Back to work mid-lesson | Instant: `mode_change` to work, then `lesson_end` abandoned, with no Evidence. |
| Grounding | Every citation I checked against the files pointed to the right lines (S2, S4, S5, S7, S8). There were no ungrounded code references. |
| Crashes, stuck UI, failed lessons | None. No `Couldn't prepare…` errors and no `lesson_error` in about 11 lesson steps. |

### Latency per lesson step

| Step | Observed |
|---|---|
| Why? → Probe | 2.8 s (S2), 8.2 s (S6), 2.8 s (S8) |
| Ask why → Probe | 4.3 s (S4), 16.0 s (S7, the first lesson of the session) |
| Ask why → adapted hint (whole lesson) | 2.4 s (S3) |
| Second complaint → Offer | 5.5 s (4.9 s detection, 0.6 s card) |
| Offer accepted → Probe | **35.3 s** (S5) |
| Probe answer → Explain + Articulation | **21.4 s** (S2), 2.2 s (S4), **18.4 s** (S5), 4.3 s (S7), 4.1 s (S8) |
| Follow-up question → answer | 4.3 s (S7), 1.5 s (S8) |
| Articulation → assessment and end | 9.3 s, 2.4 s, 3.9 s, 4.4 s, 2.9 s |

Most steps take under 5 s. The slow ones are the Explain steps that hit Teaching's 20 s draft deadline and then fall back to text, and the Offer path (Jev read gate plus Probe while the main Pi was still finishing its turn).

## Findings

Grades: **P0** breaks the loop or the demo. **P1** gives a wrong learning outcome, or a feature does not work in a real case. **P2** is a quality issue. **P3** is polish. No P0 was found.

The findings are split into two lists for hand-off. **Fix directly** holds defects with one clear fix. **Decisions needed** holds product or teaching-design choices, trade-offs between modules, and changes to `@aha/contracts` or the lesson flow. Issues in the Decision Layer's `gateEvidence`, `selectConcepts` and `detectImpasse` are only noted at the end, because #75–#77 are changing that code.

Candidate fixes for P1-5, P1-6a, P1-6b, P1-9, P2-1, P2-2 and P2-3, each with a test, are on branch `learning-eval-candidate-fixes` and are not part of this PR. A fourth live run on that branch confirmed four of them:

- Pi's shell showed no `PORT` and no Jev key.
- A Chinese question got a Chinese Probe.
- "我不知道" got *你没有做预测，所以这里只解释原因* ("you made no prediction, so I'll just explain the cause").
- The composer showed the new in-lesson hint.

The fixing agent can reuse that branch or start over.

### Fix directly

#### P1-5 Pi inherits Aha's `PORT`; a server started by Pi takes over `localhost:<aha port>` and outlives Aha

- **Repro** (S2): start Aha with `PORT=4471`. Ask Pi for a change it will verify by running the project. Pi ran `node -e "require('./server.js')" &`.
- **Evidence**: `lsof` showed two listeners on 4471: Aha on `127.0.0.1` (IPv4) and the portfolio on `*` (IPv6). `curl http://localhost:4471/` returned `<title>My Portfolio</title>`, and only `127.0.0.1:4471` served Aha. The portfolio process survived Aha's exit. This is the same root cause as the earlier "Pi killed Aha" incident.
- **Cause**: `packages/agent-host/src/pi-agent-host.ts:49` spawns Pi with `{ ...env, … }`, the whole of Aha's environment. That includes `PORT`, every `AHA_*` setting and `TYPESAFE_API_KEY`, the Jev key, which Pi does not need and could print into the Timeline.
- **Fix**: spawn Pi with the environment minus `PORT`, `TYPESAFE_API_KEY` and `AHA_*`, then add `AHA_LEARNER_CONTEXT_FILE` back. The bridge reads only that variable (`bridge-extension.ts:16`).
- **Test**: in `packages/agent-host/test/pi-agent-host.test.ts`, start the fake Pi with `PORT`, `AHA_PREVIEW_PORT` and `TYPESAFE_API_KEY` set. Have `fake-pi.mjs` log `env.PORT` and the inherited `AHA_*` and `TYPESAFE_API_KEY` keys in its `__start__` record. Expect no port, and only `AHA_LEARNER_CONTEXT_FILE`.

#### P1-9 A complete answer to a complex question earns no Evidence: the assessor times out

- **Repro** (S9 step 7): answer the 3-concept lesson's Articulation with all three causes. The answer was correct and complete.
- **Evidence**: there is no `answer_assessment`, and `lesson_end completed` came exactly 10.0 s after the answer. No Evidence was written. Short answers in the same session were assessed in 2.4–9.3 s.
- **Cause**: `packages/teaching/src/generated-lesson.ts:165` gives `assess()` `deadline(signal, 10_000)`, and its `catch` returns `undefined` silently. The longer and better the answer, the more likely it times out.
- **Fix**: raise the assessment deadline to about 30 s, the same as the Probe. Consider also logging an assessment timeout instead of swallowing it.
- **Test**: in `apps/aha/test/generated-assessment.test.ts`, make the fake background's third call (the assessment) resolve after 15 s, and expect an `answer_assessment` and Evidence. Note that `deadline()` (`generated-lesson.ts:35`) uses `AbortSignal.timeout`, which Vitest fake timers do not control. Build it on `setTimeout` and an `AbortController` so the test can use `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })`.

#### P1-6a While a Lesson starts, Enter does nothing and nothing says why

- **Repro** (S8): press Why?. While "Preparing the lesson" shows, type a message and press Enter.
- **Evidence**: the text stays in the composer. No `lesson_question` and no error appear.
- **Cause**: `packages/app/ui/App.tsx:55` sets `canSend` to false until `session.lessonReady`, and `App.tsx:109` returns silently. The placeholder at `App.tsx:138` only says *Ask a follow-up about this Lesson…*, which also does not tell the user that the agent won't get the message.
- **Fix**: derive the placeholder from the session in `timelineView.ts`: *Preparing the Lesson… you can ask about it once it starts.* before the Lesson starts, and *Ask about this Lesson (Back to work to message your agent)…* once it runs.
- **Test**: in `packages/app/test/timeline-view.test.ts`, build Timelines for work mode, learning before `lesson_start`, and learning after it, and check the placeholder for each.

#### P1-6b A question asked before the Probe is answered gives the Probe's answer away

- **Repro** (S8): press Why? on the validation change. Once the Probe shows, send *Also limit the title to 80 characters please.*
- **Evidence**: the request became a `lesson_question`, and its card answered the Probe (*a title made only of spaces is trimmed… returns a 400…*) before the learner had predicted.
- **Cause**: `lesson.ts:256` calls `explain()` with the Probe question and no answer. The follow-up instruction in `generated-lesson.ts` ("Answer the user's question directly") does not say that the prediction is still open.
- **Fix**: when `followUp` is set and there is no `answer` yet, add to the instruction: *the user has not answered the prediction question yet; do not reveal or hint at its answer.*
- **Test**: a Teaching test with a fake background. Start a lesson, call `followUp` before answering, and assert that the prompt contains that instruction.

#### P2-1 Generated cards ignore the learner's language

- **Repro** (S4): Ask why in Chinese.
- **Evidence**: the Probe was in English and the Explain in Chinese.
- **Cause**: `SYSTEM_PROMPT` (`generated-lesson.ts:21`) does not say which language to use.
- **Fix**: add *Write every field the user reads in the same language the user writes in; keep code, paths and identifiers as they are.* The fixed English strings are a separate matter (D6).
- **Test**: start a lesson with a Chinese question and answer, and assert that every background request's `systemPrompt` contains the instruction.

#### P2-2 "I don't know" is judged as a wrong prediction, then asked about

- **Repro** (S4, S7): answer a Probe with "I don't know" or "我不知道".
- **Evidence**: the S7 Explain opened with *Your prediction is not quite right*. Every Articulation asks *In your own words, what caused the behavior you predicted?*, which also does not fit a wrong prediction (S5).
- **Cause**: the Explain task at `generated-lesson.ts:119` always says *Correct or confirm the user's prediction*. The Articulation prompt is a fixed string at `lesson.ts:193`.
- **Fix**: add *If the user did not make a prediction, don't call it right or wrong; just explain.* Change the prompt to *In your own words, what causes this behavior?*.
- **Test**: answer "I don't know". Assert the Explain prompt contains the no-prediction instruction and the Articulation card has the neutral prompt.

#### P2-3 A detected Offer is titled "Understand this error" when there was no error

- **Repro** (S5): complain twice about the same problem in work mode.
- **Evidence**: the Offer read *Understand this error*, placed directly under an unrelated red tool failure.
- **Cause**: `lesson.ts:119` uses that title for every detected Impasse except the demo's login case. Detected Impasses are recurring gaps, often the user's own messages.
- **Fix**: a neutral title such as *This has come up before. Look at why?*. The body text comes from `detectImpasse` (see the note on the Decision Layer), and the placement is part of D8.
- **Test**: call `teaching.offer()` with a detected Impasse built from user messages and check the title.

#### P2-8 A Probe on a change that keeps behaviour the same is trivial

- **Repro** (S2): Why? on "store the password hashed".
- **Evidence**: the Probe *what happens when you log in with alex / portfolio123?* has the obvious answer "it works" and tests nothing about hashing.
- **Cause**: the Probe instruction (`generated-lesson.ts:103`) asks for *a prediction about the reported action and its immediate outcome*.
- **Fix**: add *If the change keeps the visible behaviour the same, ask about what the code now does differently (the mechanism), not the outcome.*
- **Test**: a prompt assertion like the ones above. The real check is live: repeat S2.

#### P3-3 Backticks in plain-text fields

- **Evidence**: Explain text shows `` `checkPassword` `` literally (S2, S4).
- **Cause**: the model ignores *Use plain text for every field* (`generated-lesson.ts:21`), and `TextExplanation` renders the text as it is.
- **Fix**: render inline code in `TextExplanation`, or strip backticks in `validateExplanation`.
- **Test**: a card-catalog test that a `TextExplanation` with backticks renders `<code>` (or no backticks).

#### Observation without a proposed fix: P2-5 slow steps

Offer accepted → Probe took 35.3 s (S5), while the main Pi was still finishing its turn. Two Explains took about 20 s (S2, S5), matching Teaching's 20 s draft deadline plus the text fallback. Shutting Aha down during an open lesson took 48 s in the fourth run (the cap is 60 s). These look like provider latency. Logging per-step timings would show where the time goes.

### Decisions needed

#### D1 What happens after a wrong or "still confused" Articulation (P1-1, P1-2)

- **Evidence**: S4's wrong Articulation (*process.env.PORT 是 Node 每次启动时自动随机分配的端口*, "a random port Node assigns at each start") was assessed `incorrect` and recorded as negative Evidence, but the panel only says "Completed". S7's *I don't know, I'm still confused.* was assessed unclear, and the lesson ended as completed with no help and no record. Both come from `lesson.ts` `answer()`: after the Articulation it always calls `complete()`.
- **Options**:
  - **A.** Show feedback on incorrect: one card saying what the cited lines actually do, then end.
  - **B.** Re-teach once: on incorrect or unclear, a second, different Explain and Articulation, with a loop limit.
  - **C.** On incorrect or unclear, offer *Explain it another way* and *Back to work*.
- **Recommendation**: A for incorrect, C for unclear. Also decide whether "still confused" is Evidence; per the glossary, self-report is not.

#### D2 Mastery rules (P1-3, P1-4, P2-6)

- **One-step jump (P1-3).** One work message pointing out a bug in the agent's `loadData` produced a strong `caught_agent_mistake`. Dreaming then moved `debugging: not_encountered → catches_agent_mistakes`. `masteryFromEvidence` (`learner-model/src/dreaming.ts`) treats any positive `caught_agent_mistake` as enough. Options: (a) at most one level per Dreaming run; (b) the top two levels need Evidence from two sessions; (c) keep it. **Recommendation:** (a).
- **`seen_explanation` is never set (P1-4).** After a full lesson with a wrong answer, `environment-variables` stayed `not_encountered`. Only `learner-model/src/stub.ts` ever produces `seen_explanation`, so the `probe_first` lesson format never runs. Options: (a) a completed lesson whose Articulation was not positive sets `seen_explanation`; (b) add an Evidence type `explanation_seen` (a contract change); (c) drop the level. **Recommendation:** (a).
- **Plateau (P2-6).** Hint lessons record nothing (S3, S9 step 10), and lesson assessments are never `strong`. Lessons alone therefore cannot raise a concept past `correct_with_hints`. Options: give hint lessons a one-line Articulation; or count a correct Articulation in a `hint` or `review` lesson as strong. **Recommendation:** the one-line Articulation.

#### D3 Questions the project code cannot answer (P1-7)

- **Evidence**: S3 asked *Why does the stored password need a salt?* after hashing was mastered. It got one hint card pointing at `scryptSync` arguments and completed in 2.4 s; the reason for a salt is not in the code. In S9 step 3, the follow-up *Is localStorage safe? Could another website read my token?* got a card that re-explained the fix. The grounding rules (every claim cites project lines) pull answers back to the code.
- **Options**:
  - **A.** For `ask_why` and follow-ups, always answer the question, even in the `hint` format; adapt only the length.
  - **B.** Allow one labelled sentence of general knowledge (*not from your project*) that the grounding check skips.
  - **C.** Keep it as it is.
- **Recommendation**: A and B.

#### D4 Questions and answers that involve several concepts (P1-8, P2-10)

- **Evidence**: S9 step 6 asked why projects disappeared after refresh, logout *and* restart. The Probe and Explain covered only logout, and only in the fixed code. Teaching's system prompt says *Stay with the action and outcome described there*, and the sources are the current files. Separately, `assess()` credits *at most one listed Concept*. In S9 the learner correctly explained five concepts and the model credits two.
- **Options for scope**: (a) up to 3 causes when the Impasse names several outcomes, with the session's earlier diffs as "before" sources; (b) one Lesson per concept, one after another; (c) keep one concept and say what was left out.
- **Options for credit**: up to 2 concepts per answer (this matches #75–#77's read gate limit of 2; `answer_assessment.conceptIds` is already an array), or keep 1.
- **Recommendation**: (a) for scope, and 2 concepts for credit.

#### D5 Work requests typed during a Lesson (P1-6, rest)

Every message in learning mode becomes a Lesson question and never reaches Pi (S8). Options: (a) keep it and say so (P1-6a); (b) add a *Send to agent* action that queues the message for Pi after the Lesson; (c) classify messages and route them. **Recommendation:** (b).

#### D6 Fixed UI strings in English (P2-1, rest)

The Articulation prompt, the Offer titles, the hint titles and "Lesson complete. Back to work." are fixed English strings. Options: generate the Articulation prompt with the Explain, in the learner's language; add an interface language setting; or keep English. **Recommendation:** generate it for lesson cards.

#### D7 Processes started by Pi outlive Aha (P2-9)

An `agent-browser` daemon (run B, parent PID 1) and the P1-5 portfolio server kept running after Aha exited. Options: start Pi in its own process group and kill the group on exit; ask Pi, through the bridge, to clean up at session end; or leave it to the user. **Recommendation:** kill the group. That also stops a dev server the user may want to keep, so say so on exit.

#### D8 Choosing the change to ask about; when Offers appear (P2-7, P2-11, P2-3 placement)

S9 had 15 Why? buttons after four work turns, four on identical `Edited server.js` cards. In S6, a Why? on the last of three edits in one turn gave a lesson on an obscure edge case. The S5 Offer appeared in the middle of Pi's running turn. Options: one Why? per agent turn and file, covering all of that turn's edits; label cards with a summary of the diff; show Offers after the turn ends. **Recommendation:** one Why? per turn and file, and Offers after the turn.

#### D9 Empty Dreaming sections in the change log (P3-1)

Run A's change log has 11 idle sections, and only 3 contain a change. `learner-model/test/store.test.ts` asserts that every run is logged, so this is intended today. Options: skip empty runs; or write them as one line. **Recommendation:** skip them.

#### D10 `related_files` stays empty (P3-2)

Concept files keep `related_files: []` although every lesson cited files. Evidence carries entry IDs but no files, so filling it needs either a field on Evidence (a contract change) or Dreaming reading the Timeline. **Recommendation:** add the cited paths to Evidence when the backend records an assessment.

#### Not proposed for change

P3-4: the Ask why toggle resets after each question. This looks intended.

### Decisions taken on D1–D4 (2026-11-25)

D5–D10 are still open.

**D1, feedback after the Articulation.** When an Articulation is assessed incorrect or unclear, the Lesson does not complete:
- The assessment call also returns one or two sentences that correct or extend the answer, so there is no extra model call.
- Aha shows those sentences on a feedback card. The Lesson stays open for follow-up questions (the existing Lesson questions), and the learner ends it with Back to work.
- "Explain it another way" is done by asking a follow-up, so no new card type or button is needed.
- Evidence rules are unchanged: incorrect is negative Evidence; "still confused" is self-report and is not Evidence.

**D2, mastery rules** (`masteryFromEvidence`; no contract change):
- *One-step jump.* A single piece of Evidence raises a Concept at most to `correct_with_hints`. `explains_independently` and `catches_agent_mistakes` each need at least two positive pieces of Evidence, at least one of the matching type: an independent fix, a caught agent mistake, or (below) a strong Articulation.
- *`seen_explanation`.* Negative Evidence from a Lesson (Probe or Articulation) raises a Concept to at least `seen_explanation`, so the `probe_first` format can run. Negative Evidence still never lowers a level, and there is no decay for now.
- *Plateau.* Hint Lessons get a one-sentence Articulation. A correct answer there is strong Evidence that the learner explains the Concept with little help. Two of them reach `explains_independently`.

**D3, questions the project code cannot answer:**
- **A.** Questions the learner asks (Ask why and follow-ups) are always answered. A mastered Concept makes the answer shorter but never withholds the conclusion. The hint format that leaves the conclusion to the learner applies only to Why? on an agent change.
- **B.** `TextExplanation` gets an optional `background` field: at most two sentences of general knowledge, shown as *General background, not from your project*. It is allowed only for Ask why and follow-ups, is skipped by the grounding check, and the rest of the card must still tie it to the cited lines. This is an additive change to the card catalog in `@aha/contracts`; the App Shell renders the new field.

**D4, several Concepts in one question.** The limit is 2 per Lesson, which matches the read gate's limit of 2 Concepts after #77:
- *Scope.* A Lesson covers at most 2 causes: those most relevant to the question, root cause first. It ends by naming any other cause and suggesting an Ask why about it.
- *Before-state.* The session's earlier diffs of the cited files are added to the Lesson sources, so the Lesson can show how the bug happened, not only the fixed code.
- *Credit.* An Articulation can credit up to 2 Concepts, each backed by its own quote from the answer. `answer_assessment.conceptIds` is already an array.

### Note: Decision Layer issues (not covered here; #75–#77 are changing this code)

Re-check these after those PRs merge:

- **Concept choice.** `gateEvidence` put S6's caught mistake about file persistence on the catch-all `debugging`.
- **Duplicate Evidence.** `gateEvidence` recorded one repeated gap twice: ev-3 for the user message and ev-4 for the detected Impasse (S5).
- **Read gate.** `selectConcepts` apparently skipped already-mastered concepts that were clearly relevant (`database-persistence` in S6; `session-tokens` in S9 steps 6 and 9), so those lessons did not adapt. Logging its picks would make this checkable.
- **Offer body.** `detectImpasse` sets the Offer body to *A similar issue has come up again: <raw message>*.

## Environment note

The user's own Pi answered English messages in Chinese and runs extra extensions (auto-mode, a visual `look` loop, `agent-browser`). That comes from the local Pi configuration, not from Aha, but it is what a real user's Pi will look like: Aha has to cope with long turns full of extra tool calls (S5 and S8 had 150+ Timeline entries per turn).

## Verdict on real-world feasibility

**The loop is workable outside the scripted demo, including a long, complex session.** Across nine scenarios, seven new concepts, two languages, three trigger paths (Why?, Ask why, detected Offer), short and long sessions, and simple and multi-file changes, every lesson produced grounded, accurate cards. Explain diagrams stayed correct across `server.js` and `public/app.js`. Evidence reached the session file, and idle and shutdown Dreaming both updated mastery. Later lessons in the same session adapted to what the learner had shown earlier. In the 12-step session neither latency nor the UI got worse as the Timeline grew past 1,100 entries, and the Learner Model stayed free of duplicates and contradictions. Nothing crashed or got stuck. That is enough to support a real-world feasibility claim for the pipeline and the architecture.

**What is not yet trustworthy is the pedagogy at the edges and the Learner Model's accuracy, and both get worse with complexity.** The loop serves the learner who gives a short, right answer to a one-concept question well. It goes quiet for the learner who is wrong or confused (P1-1, P1-2). It can withhold an answer the learner asked for (P1-7). It cuts a multi-concept question down to one case (P1-8). It throws away the best answer to a complex question when the assessor times out (P1-9). It credits one concept per answer (P2-10). The model is therefore inaccurate in both directions: one message can push a generic concept to the top level (P1-3), while correctly explained concepts stay "not encountered", and one level is never reached at all (P1-4). The work/learning boundary also has two real-use hazards (P1-5, P1-6).

For the report: the architecture and the live loop are feasible, short sessions work end to end, and a long session stays stable. Feedback after the Articulation, multi-concept questions and assessments, and the mastery rules need the listed fixes before the model's mastery levels can be trusted with real novices. Concept selection should be measured again after #75–#77 merge.

