# Learning scenarios beyond the scripted demo

A live evaluation of whether Aha's learning loop works outside `docs/demo.md`. Run on 2026-11-25 with every module real: the user's own Pi (RPC), Jev decisions, the Markdown Learner Model, generated Teaching and the background Pi. `AHA_DREAM_IDLE_MS=30000`.

Two sessions, each on a fresh copy of `examples/portfolio` with an empty Learner Model:

- **Run A**: `/tmp/aha-eval-a`, Aha on port 4471, preview on 4472. Scenarios S1–S6, then Ctrl-C (SIGINT).
- **Run B**: `/tmp/aha-eval-b`, Aha on port 4481, preview on 4482. Scenarios S7–S8, then SIGINT.

Every step was driven through the web UI in a browser. Timings come from the `at` timestamps of Timeline entries, recorded by a WebSocket listener. The Evidence and mastery shown are the files under `<project>/.aha/learner-model/`.

## Scenarios and outcomes

| # | Scenario (what varies) | Trigger | What Aha showed | Learner Model result | Verdict |
|---|---|---|---|---|---|
| S1 | Pure work turn: change the page subtitle | none | Nothing: no Impasse, no Offer, no card | No Evidence | ✅ as intended |
| S2 | Password hashing (new concept); a learner who answers correctly | Why? on the `server.js` change | Probe → Explain (text, grounded) → Articulation, assessed **correct** | `password-hashing`: Evidence ev-1 (positive), then idle Dreaming made it `not_encountered → correct_with_hints` | ✅ |
| S3 | The same concept after S2's mastery change ("why a salt?") | Ask why | An adapted lesson: one hint card, completed at once | No Evidence | ⚠️ The format adapted, but the question was never answered (P1-7) |
| S4 | Environment variables; the question is in **Chinese**; the learner says "我不知道", then gives a **wrong** Articulation | Ask why (Chinese) | Probe in English → Explain in Chinese → Articulation, assessed **incorrect** | `environment-variables`: ev-2 (negative); mastery stays `not_encountered` | ⚠️ The assessment was right, but the learner never sees it (P1-1); there is a language mix (P2-1) |
| S5 | **Repeated confusion**: data lost after a restart, twice; persistence to a file | detected (Jev) | **Offer** 5.5 s after the second message → Probe → wrong prediction → Explain (DataFlowDiagram that corrects it) → Articulation, assessed **correct** | `database-persistence`: ev-3 and ev-4 (`repeated_gap`, duplicates), ev-5 (positive), then `→ correct_with_hints` | ✅ the loop works; P2 quality issues |
| S6 | **Advanced learner** catches a real bug in the agent's `loadData` | work message, then Why? on the fix | No lesson on the message. Why? afterwards gave a full Probe on an obscure edge case; Back to work ended it cleanly | ev-6: `caught_agent_mistake`, strong, on **`debugging`**, so `debugging: not_encountered → catches_agent_mistakes` from one message | ❌ wrong concept and a one-shot jump to the top level (P1-3) |
| S7 | Fetch error with the server stopped; there is **no agent change**; the learner says "I don't know" twice and asks a follow-up | Ask why | Probe → Explain → a follow-up question answered with grounding → the Articulation "I don't know, I'm still confused" ends the lesson as **completed** | No Evidence (assessed unclear) | ⚠️ the confused learner is dropped (P1-2) |
| S8 | Form validation (empty title); a **work request typed during a Lesson** | Why? on the `server.js` change | The request was silently not sent, then became a Lesson question that Pi never saw, and the answer gave away the Probe. The rest of the lesson was assessed **correct** | `input-validation`: ev-1, then SIGINT Dreaming made it `→ correct_with_hints` | ⚠️ learning blocks work (P1-6) |

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

## Problems

Grades: **P0** breaks the loop or the demo. **P1** gives a wrong learning outcome, or a feature does not work in a real case. **P2** is a quality issue. **P3** is polish. No P0 was found.

### P1-1 A wrong Articulation gets no feedback; the lesson just says "Completed"

- **Repro** (S4): Ask why *为什么 server.js 里要写 process.env.PORT || 3000？* → Probe "我不知道" → Articulation *因为 process.env.PORT 是 Node 每次启动时自动随机分配的端口…* (a misconception).
- **Evidence**: `answer_assessment articulate incorrect environment-variables` 2.4 s later, then `lesson_end completed`. Session file ev-2 is `negative`. The Learning panel shows only the learner's answer and "Completed". No text anywhere tells them the answer was wrong (checked against the page text).
- **Impact**: the system knows the learner holds a misconception and leaves it standing. That is the one moment a tutor must react. See `packages/teaching/src/lesson.ts`, `answer()`: the generated path calls `complete()` with only the assessment.

### P1-2 "I'm still confused" ends the lesson as completed, with no help and no record

- **Repro** (S7): Ask why about a fetch error with the server stopped → Probe "I don't know" → Articulation *I don't know, I'm still confused.*
- **Evidence**: there is no `answer_assessment` (the assessor returned `unclear`, which is dropped), then `lesson_end completed` 4.4 s later, and no Evidence. The UI says "Lesson complete. Back to work."
- **Impact**: the learner who most needs a second explanation is sent back to work, and the Learner Model has no trace that the gap remains. P1-1 and P1-2 share one cause: after the Articulation the lesson always ends, whatever the result.

### P1-3 One work message lifts a generic concept straight to the top mastery level

- **Repro** (S6): in work mode send *I think there's a bug in your loadData: if projects.json is corrupt it just starts with no projects, and then the next saveData overwrites the file…*
- **Evidence**: session ev-6 is `concept: debugging · type: caught_agent_mistake · positive · strong`. The next idle Dreaming logged `debugging: not_encountered → catches_agent_mistakes`.
- **Impact**: two errors. (a) The write gate attributed the Evidence to the catch-all `debugging` rather than to `database-persistence` or `error-handling`, the concepts the catch is actually about. (b) One unverified message jumps four levels at once, because `masteryFromEvidence` treats any positive `caught_agent_mistake` as enough. Lessons that look up `debugging` will now skip straight to the `review` format. The learner did not demonstrate this level.

### P1-4 The real Learner Model never sets `seen_explanation`, so the `probe_first` lesson format is unreachable

- **Repro**: S4. The learner sat through a full lesson (Probe, Explain, Articulation) on `environment-variables` and answered wrongly.
- **Evidence**: after Dreaming, `concepts/environment-variables.md` still says `mastery: not_encountered`, and `index.md` lists it as not encountered. `grep seen_explanation packages/*/src` finds it set only in `learner-model/src/stub.ts`. `dreaming.ts` has no path to it.
- **Impact**: one of the five Mastery Levels and one of Teaching's adapted formats (`probe_first`) never happen with real modules. The model also reports "not encountered" for a concept the user has just had explained.

### P1-5 Pi inherits Aha's `PORT`; a project server started by Pi takes over `localhost:<aha port>` and outlives Aha

- **Repro** (S2): Pi verified its hashing change with `node -e "require('./server.js')" &`. Because `server.js` reads `process.env.PORT`, the child got `PORT=4471`, Aha's own port.
- **Evidence**: `lsof` showed two listeners on 4471: Aha on `127.0.0.1` (IPv4) and the portfolio on `*` (IPv6). `curl http://localhost:4471/` returned `<title>My Portfolio</title>`, and only `http://127.0.0.1:4471/` returned Aha. After SIGINT the portfolio process was still running (I killed it).
- **Impact**: a user who opens `localhost` instead of `127.0.0.1` gets their own project instead of Aha. This is the same root cause as the earlier "Pi killed Aha" incident (Pi inherits `PORT`), with a new symptom. It is in the agent-host environment, not in the project.

### P1-6 A work request typed during a Lesson is dropped, then turned into a Lesson question

- **Repro** (S8): press Why? on an agent change. While "Preparing the lesson" shows, type *Also limit the title to 80 characters please.* and press Enter. Press Enter again once the Probe appears.
- **Evidence**: the first Enter did nothing visible. The text stayed in the composer and no error was shown (the backend rejects it with "The Lesson is still starting", which the UI does not display). The second Enter became `lesson_question`. The reply ("Whitespace-only titles are rejected… returns a 400…") ignored the request and **revealed the answer to the Probe** before the learner had predicted. Pi never received the request, and `server.js` has no 80-character limit.
- **Impact**: while a Lesson runs, the user cannot direct the agent, and they are not told their request went nowhere. The follow-up path can also give the Probe away. The composer placeholder does change to "Ask a follow-up about this Lesson…", but novices will type work requests there anyway.

### P1-7 An adapted hint for a conceptual "why" question cannot lead to the answer

- **Repro** (S3): after S2 raised `password-hashing` to `correct_with_hints`, Ask why *Why does the stored password need a salt? Couldn't the server just keep the hash?*
- **Evidence**: there is a single card, "Check how the salt is used: … compare the two stored fields … with the arguments passed to crypto.scryptSync…", and the lesson completes at once (2.4 s). The reason for a salt (identical passwords give different hashes; precomputed tables do not work) is not in the code, so reading the cited lines cannot answer the question. No follow-up is possible because the session is back in work mode.
- **Impact**: earlier mastery of a neighbouring idea ("store hashes") was used to withhold an explanation the learner explicitly asked for. When the Impasse is a direct question, the `hint` format should probably still answer it.

### P2-1 Language mix for non-English learners

S4: the question was in Chinese. The Probe was in English (*If this server is started in an environment where the PORT variable…*), the Explain was in Chinese, and the Articulation prompt is a fixed English string. The Offer title, the hint titles and "Lesson complete. Back to work." are English too.

### P2-2 The Articulation prompt and the Explain wording do not fit wrong or empty predictions

The Articulation is always *In your own words, what caused the behavior you predicted?*. After "I don't know" (S4, S7) or a wrong prediction (S5) there is no predicted behavior to explain. The S7 Explain opened with *Your prediction is not quite right* in reply to "I don't know".

### P2-3 Offer card: misleading title, placement and wording

S5: the Offer for a repeated user complaint is titled **"Understand this error"**, though there was no error. Its body is the raw message prefixed with *A similar issue has come up again:*. It appears in the conversation in the middle of Pi's still-running turn, directly under an unrelated red tool failure (`ls: projects.json.tmp: No such file or directory`), so it reads as being about that failure.

### P2-4 One repeated gap is recorded twice

S5: ev-3 (`repeated_gap`, strong, entry 356, the user message) and ev-4 (`repeated_gap`, strong, entries 357/214/356, the detected Impasse) describe the same occurrence. Today this has no mastery effect because negative Evidence never lowers mastery, but any future use of negative Evidence would double-count.

### P2-5 Slow steps: Offer → Probe 35 s; two Explains around 20 s

See the latency table. The 35 s case ran while the main Pi was still finishing its turn after the Offer appeared. The two ~20 s Explains match Teaching's 20 s draft deadline followed by the text fallback. This was also seen in the demo hand-over.

### P2-6 Mastery stalls at `correct_with_hints` through lessons alone

`hint` lessons (S3) complete without any assessment, so they produce no Evidence. Lesson assessments only ever record `moderate` or `weak` strength, while `explains_independently` needs `independent_fix` and `catches_agent_mistakes` needs strong Evidence or `caught_agent_mistake`. Both of those come only from Jev's gate on work messages. Lessons cannot carry a learner past `correct_with_hints`. The only path past it is the one-message jump in P1-3.

### P2-7 Why? on one of several edits from one turn gives a narrow lesson, and adaptation is inconsistent

S6: Pi edited `server.js` three times in one turn. Why? on the last edit gave the Probe *what will happen immediately at startup if projects.json has a non-null projects value that is an array?*, an edge case a novice would not care about. The format was `full`, although `database-persistence` was already `correct_with_hints` and is clearly relevant, so the read gate apparently did not pick it. I could not confirm this, because the read gate's choice is not logged.

### P2-8 A Probe on a behaviour-preserving change is trivial

S2: the hashing change keeps login working, so the Probe *what happens when you log in with alex / portfolio123?* has the obvious answer "it works" and does not test hashing. It was the learner's own extra detail that made the lesson useful.

### P2-9 Processes started by Pi outlive Aha

Besides P1-5's server, Pi's run-B turn started an `agent-browser` daemon (cwd `/tmp/aha-eval-b`, parent PID 1) that was still running after Aha exited. Stopping Aha does not stop what the agent started.

### P3-1 Idle Dreaming writes empty change-log sections

Run A's `changelog.md` has 11 `## Dreaming (idle, …)` headings, and only 3 of them contain a change.

### P3-2 `related_files` stays empty

The concept files keep `related_files: []` even though each lesson cited specific files.

### P3-3 Markdown in plain-text fields

Explain text contains backticks (`` `checkPassword` ``), which the card shows literally.

### P3-4 The Ask why toggle resets after every question

The second Chinese question in S4 went to Pi as a work message until I turned the toggle on again. This may be intended, but it is easy to miss.

## Environment note

The user's own Pi answered English messages in Chinese and runs extra extensions (auto-mode, a visual `look` loop, `agent-browser`). That comes from the local Pi configuration, not from Aha, but it is what a real user's Pi will look like: Aha has to cope with long turns full of extra tool calls (S5 and S8 had 150+ Timeline entries per turn).

## Verdict on real-world feasibility

**The loop is workable outside the scripted demo.** Across six new concepts (hashing, env vars, persistence, fetch errors, validation, plus a debugging catch), two languages and three trigger paths (Why?, Ask why, detected Offer), every lesson produced grounded, accurate cards. Assessments matched the answers (correct ×3, incorrect ×1, unclear ×1). Evidence reached the session file, idle and shutdown Dreaming both updated mastery, and the next related lesson adapted. Nothing crashed, nothing got stuck, Back to work was instant, and most steps took under 5 s. That is enough to support a real-world feasibility claim for the pipeline.

**What is not yet trustworthy is the pedagogy at the edges and the Learner Model's accuracy.** The loop handles the learner who gets it right well. It goes quiet for the learner who is wrong or confused (P1-1, P1-2). It can withhold an answer the learner asked for (P1-7). One message can push a generic concept to the top level (P1-3), while a level in the middle is never reached (P1-4). The work/learning boundary also has two real-use hazards (P1-5, P1-6). For the report I would say: the architecture and the live loop are feasible; learner modelling and feedback after an Articulation need the listed fixes before the model's mastery levels can be trusted with real novices.
