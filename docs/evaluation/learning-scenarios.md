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
- **Seen again in S9, step 3**: inside a full lesson, the follow-up *Is localStorage safe for this? Could another website read my token?* got a card that re-explained the refresh fix and said nothing about safety. The grounding rules (every claim must cite project lines) seem to push answers toward what the code shows, even when the question is about something the code cannot show.

### P1-8 A question about 2–3 concepts is cut down to one case, in the current code only

- **Repro** (S9, step 6): after Pi had fixed refresh, logout and restart, Ask why *Why did my projects disappear before in three different ways: after a page refresh, after logging out, and after a server restart? Are those the same problem?*
- **Evidence**: the Probe asked only *When Alex logs out and then logs back in, what will the project list show?*. When the learner replied *I wanted to know why it failed before, in all three cases*, the Explain was a diagram of the **logout path in the fixed code** only. Refresh, restart and the old behaviour were never mentioned.
- **Impact**: the question that connects three concepts (session tokens, data belongs to the user, persistence), which is the most valuable one for a novice, gets the narrowest lesson. Two causes are visible in the code. Teaching's system prompt says *Stay with the action and outcome described there… Don't add another action*. And the sources are the current files, so "before" is only visible through the latest diff, while these three bugs were fixed by three different edits. *(read gate: with #75–#77 limiting selection to 2 Concepts, a 3-concept question cannot even get all three into Learner Context; worth testing again after they merge.)*

### P1-9 A complete answer to a complex question earns no Evidence: the assessor times out

- **Repro** (S9, step 7): answer the Articulation of the 3-concept lesson with *Three different causes: refresh made a new random token…; logout lost them because projects were stored inside the session…; restart lost them because everything was only in memory, now they go to data/projects.json.*
- **Evidence**: there is no `answer_assessment`, and `lesson_end completed` came exactly **10.0 s** after the answer. That is the `deadline(signal, 10_000)` in `generated-lesson.ts` `assess()`, whose `catch` returns `undefined`. The session file has no Evidence for this lesson. Shorter, simpler answers in the same session were assessed in 4.0–8.6 s.
- **Impact**: the better and longer the learner's answer, the more likely it is to be thrown away, the opposite of what the Learner Model should reward. This is also silent: the learner and the model both see "completed".

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

S6: Pi edited `server.js` three times in one turn. Why? on the last edit gave the Probe *what will happen immediately at startup if projects.json has a non-null projects value that is an array?*, an edge case a novice would not care about. The format was `full`, although `database-persistence` was already `correct_with_hints` and is clearly relevant, so the read gate apparently did not pick it. I could not confirm this, because the read gate's choice is not logged. S9 repeats the pattern: with `session-tokens` mastered, a direct Ask why about tokens adapted, but a Why? on the delete change (step 9) and the 3-concept question (step 6), which both depend on tokens, ran as full lessons. *(read gate: likely affected by #75–#77.)*

### P2-8 A Probe on a behaviour-preserving change is trivial

S2: the hashing change keeps login working, so the Probe *what happens when you log in with alex / portfolio123?* has the obvious answer "it works" and does not test hashing. It was the learner's own extra detail that made the lesson useful.

### P2-9 Processes started by Pi outlive Aha

Besides P1-5's server, Pi's run-B turn started an `agent-browser` daemon (cwd `/tmp/aha-eval-b`, parent PID 1) that was still running after Aha exited. Stopping Aha does not stop what the agent started.

### P2-10 Each answer credits at most one concept, so the Learner Model under-counts

S9: the step-4 Articulation correctly explained session tokens, localStorage and per-user storage, and only `session-tokens` was credited. `assess()` is told *Choose at most one listed Concept*. After a 12-step session in which the learner correctly explained five concepts, the model shows two. *(read gate: #75–#77 narrow the candidate list to 2 but would not change the one-per-answer rule.)*

### P2-11 In a long session it is hard to press Why? on the right change

S9: after four work turns the conversation had 15 Why? buttons on change cards. Four said `Edited server.js` with no other distinguishing text, and Pi's tool calls between them push them far apart. A novice cannot tell which `server.js` change is the one they are confused about. S6 shows the cost: a Why? on the last of several edits gives a lesson about a small detail.

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

**The loop is workable outside the scripted demo, including a long, complex session.** Across nine scenarios, seven new concepts, two languages, three trigger paths (Why?, Ask why, detected Offer), short and long sessions, and simple and multi-file changes, every lesson produced grounded, accurate cards. Explain diagrams stayed correct across `server.js` and `public/app.js`. Evidence reached the session file, and idle and shutdown Dreaming both updated mastery. Later lessons in the same session adapted to what the learner had shown earlier. In the 12-step session neither latency nor the UI got worse as the Timeline grew past 1,100 entries, and the Learner Model stayed free of duplicates and contradictions. Nothing crashed or got stuck. That is enough to support a real-world feasibility claim for the pipeline and the architecture.

**What is not yet trustworthy is the pedagogy at the edges and the Learner Model's accuracy, and both get worse with complexity.** The loop serves the learner who gives a short, right answer to a one-concept question well. It goes quiet for the learner who is wrong or confused (P1-1, P1-2). It can withhold an answer the learner asked for (P1-7). It cuts a multi-concept question down to one case (P1-8). It throws away the best answer to a complex question when the assessor times out (P1-9). It credits one concept per answer (P2-10). The model is therefore inaccurate in both directions: one message can push a generic concept to the top level (P1-3), while correctly explained concepts stay "not encountered", and one level is never reached at all (P1-4). The work/learning boundary also has two real-use hazards (P1-5, P1-6).

For the report: the architecture and the live loop are feasible, short sessions work end to end, and a long session stays stable. Feedback after the Articulation, multi-concept questions and assessments, and the mastery rules need the listed fixes before the model's mastery levels can be trusted with real novices. Concept selection should be measured again after #75–#77 merge.
