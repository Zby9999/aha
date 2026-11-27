# Mastery Levels move by observations, never by one message

Dreaming sets each Concept's Mastery Level in `masteryFromEvidence` (`packages/learner-model/src/dreaming.ts`). The live evaluation in `docs/evaluation/learning-scenarios.md` found three problems with the first rules: one work message moved `debugging` to the top level (P1-3), `seen_explanation` was never set so the `probe_first` format never ran (P1-4), and Lessons alone could not lift a Concept past `correct_with_hints` (P2-6). The team decided D2 on 2026-11-25:

- One piece of Evidence raises a Concept at most to `correct_with_hints`. Records with the same outcome, type and entries count as one observation.
- `explains_independently` needs two positive observations, one of them an independent fix or a strong Articulation. `catches_agent_mistakes` needs two, one of them a caught agent mistake (or a strong fix judgement together with a strong Articulation, as in the demo).
- Negative Probe or Articulation Evidence from a Lesson raises a Concept to at least `seen_explanation`.
- A hint Lesson ends with a one-sentence Articulation. The backend records a correct Articulation in a Lesson without a Probe (a hint or a review) as strong Evidence, because the learner gave it with little help.
- A weak positive observation alone does not reach `correct_with_hints`; it takes two weak ones or one moderate or strong one. A weak positive Probe or Articulation from a Lesson (a `partial` answer) alone raises a Concept to `seen_explanation`, like a wrong one. Added 2026-11-27 after walkthrough W5 (#95): one Articulation that left out one of three causes had raised two Concepts to `correct_with_hints`, so the next Lesson would have been a hint.
- A level is never lowered, and there is no decay for now.

There is no contract change: the strength comes from what the Lesson showed, which the backend reads from the Timeline.

## Considered Options

- For #95, recording a `partial` answer as negative weak Evidence instead: it reaches `seen_explanation` through the existing rule with no rule change, but the Evidence log would call a partly right answer negative.

- At most one level per Dreaming run: simpler, but a learner who shows a lot in one session would need several idle periods to reach the level they showed.
- Evidence from two sessions for the top levels: stricter, but a single-session evaluation could never reach them.
- A new Evidence type `explanation_seen`: clearer in the log, but a contract change for something the existing negative Evidence already says.
