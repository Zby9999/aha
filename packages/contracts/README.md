# @aha/contracts

Shared types every module codes against (ADR-0002). Changing anything here is a cross-team pull request reviewed by every affected owner.

| File | What it defines |
|---|---|
| `src/timeline.ts` | Timeline entry kinds and payloads, the `Timeline` interface, an in-memory `createTimeline`, `currentMode` and `activeLesson` |
| `src/learning.ts` | Mode, Impasse, Lesson steps, Evidence, Concept, Mastery Level, Learner Context, Citation |
| `src/cards.ts` | Lesson card specs (json-render `Spec`), catalog component names, interactive card props, `CardAnswer` |
| `src/modules.ts` | Interfaces of the agent host, restricted Pi session (`BackgroundAgent`), decision service, learner model store, teaching, and `AhaModules` for wiring |
| `src/protocol.ts` | `UserAction` and the WebSocket messages between the app UI and the backend |

The original `cardComponentDefinitions` export remains usable by existing App renderers. Use `lessonCardComponentDefinitions` with the full diagram registry and gallery fixtures.

## Who writes which Timeline entry

Every entry has a `kind`, a `version` (currently 1) and the `source` module that wrote it. Modules read only the Timeline, never Pi directly.

| Kind | Written by | When |
|---|---|---|
| `session_start`, `session_end` | app (agent-host for `session_end` with reason `agent_exit`) | Session opens / closes, or Pi exits |
| `user_message`, `agent_message_delta`, `agent_message`, `tool_call`, `tool_result`, `file_edit`, `unknown_agent_event` | agent-host | Mapped from Pi RPC events |
| `error` | agent-host or app | An agent or tool error, or a Lesson start or follow-up that fails |
| `impasse` | app (Why on a change, Ask why) or decisions (detected repeated gap) | A learning moment starts |
| `offer` | teaching, appended by the backend | Only for detected Impasses |
| `offer_response` | app | User accepts ("Show me why") or skips, which declines and lets the agent carry on. Skipping is never Evidence |
| `lesson_start`, `lesson_card`, `answer_assessment` | teaching, appended by the backend | Lesson content and answer feedback, with steps adapted to mastery |
| `lesson_end` | teaching, appended by the backend, or app as an abandonment fallback | The Lesson completes or the learner returns to work early |
| `mode_change` | app | The backend owns the Mode: `learning` when a Lesson is requested (accept, Why, Ask why), `work` when it ends |
| `card_answer`, `lesson_question`, `explanation_flagged` | app | User answers a card, asks a follow-up in learning mode, or flags an explanation |
| `lesson_error`, `lesson_answer_recovered` | app | An answered step fails to advance, or a successful retry resolves that failure |

## Flow through the modules

1. The agent host appends agent events.
2. After each turn the backend asks `DecisionService.detectImpasse`; a detection becomes an `impasse` entry plus an `offer`, unless `Teaching.offer` returns null because the Mastery Level says not to interrupt.
3. Why and Ask why become an `impasse` entry directly and start a Lesson without an Offer.
4. On accept, the backend asks `selectConcepts` (read gate), reads those Concepts from the `LearnerModelStore`, and calls `Teaching.startLesson`; answers go to `Teaching.answer`.
5. A Lesson request immediately writes `mode_change` to `learning`, so the backend rejects other starts until the current request ends. In learning mode `send_message` becomes a `lesson_question` answered by `Teaching.followUp`. An agent turn already running may finish. A published Lesson ends with `lesson_end` after its final step, or as abandoned when the learner chooses `back_to_work`. A hint or short explanation can be the final step. Canceling before the start is published returns the Mode to `work` without a `lesson_end`.
6. The write gate evaluates events outside the Lesson. Inside a Lesson, Teaching assessments stay on the Timeline until completion. On `lesson_end: completed`, the backend records one Evidence entry per answer and Concept. On abandonment, the Timeline keeps the conversation and the learner model receives no assessment from that Lesson.
7. At `session_end` or idle the backend calls `LearnerModelStore.dream`.

Layout choice stays in the browser and is not a backend action. `createTimeline` and the WebSocket messages live here because every module's tests and the app's two halves share them.

Every `DecisionService` question may return `null` ("no decision"); callers then take the safe default and carry on.
