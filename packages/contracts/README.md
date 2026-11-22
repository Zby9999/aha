# @aha/contracts

Shared types every module codes against (ADR-0002). Changing anything here is a cross-team pull request reviewed by every affected owner.

| File | What it defines |
|---|---|
| `src/timeline.ts` | Timeline entry kinds and payloads, the `Timeline` interface, an in-memory `createTimeline`, `currentMode` and `activeLesson` |
| `src/learning.ts` | Mode, Impasse, Lesson steps, Evidence, Concept, Mastery Level, Learner Context, Citation |
| `src/cards.ts` | Lesson card specs (json-render `Spec`), catalog component names, interactive card props, `CardAnswer` |
| `src/modules.ts` | Interfaces of the agent host, restricted Pi session (`BackgroundAgent`), decision service, learner model store, teaching, and `AhaModules` for wiring |
| `src/protocol.ts` | `UserAction` and the WebSocket messages between the app UI and the backend |

## Who writes which Timeline entry

Every entry has a `kind`, a `version` (currently 1) and the `source` module that wrote it. Modules read only the Timeline, never Pi directly.

| Kind | Written by | When |
|---|---|---|
| `session_start`, `session_end` | app (agent-host for `session_end` with reason `agent_exit`) | Session opens / closes, or Pi exits |
| `user_message`, `agent_message_delta`, `agent_message`, `tool_call`, `tool_result`, `file_edit`, `error`, `unknown_agent_event` | agent-host | Mapped from Pi RPC events |
| `impasse` | app (Why on a change, Ask why) or decisions (detected repeated gap) | A learning moment starts |
| `offer` | teaching, appended by the backend | Only for detected Impasses |
| `offer_response` | app | User accepts ("Show me why") or skips, which declines and lets the agent carry on. Skipping is never Evidence |
| `lesson_start`, `lesson_card`, `answer_assessment`, `lesson_end` | teaching, appended by the backend | Probe → Explain → Articulate → back to work |
| `mode_change` | app | The backend owns the Mode: `learning` when a Lesson is requested (accept, Why, Ask why), `work` when it ends |
| `card_answer`, `lesson_question`, `explanation_flagged` | app | User answers a card, asks a follow-up in learning mode, or flags an explanation |

## Flow through the modules

1. The agent host appends agent events.
2. After each turn the backend asks `DecisionService.detectImpasse`; a detection becomes an `impasse` entry plus an `offer`, unless `Teaching.offer` returns null because the Mastery Level says not to interrupt.
3. Why and Ask why become an `impasse` entry directly and start a Lesson without an Offer.
4. On accept, the backend asks `selectConcepts` (read gate), reads those Concepts from the `LearnerModelStore`, and calls `Teaching.startLesson`; answers go to `Teaching.answer`.
5. The session is always in one Mode. A Lesson request writes `mode_change` to `learning` at once, so the backend rejects any further Lesson start (`startsLesson` actions) until it ends. In learning mode `send_message` becomes a `lesson_question` answered by `Teaching.followUp` and never reaches the agent; an agent turn already running may finish. The Lesson ends with `lesson_end`, completed after the Articulation or abandoned by `back_to_work` (`Teaching.abandon`, never Evidence), and the backend writes `mode_change` back to `work`.
6. New entries go through `gateEvidence` (write gate); passing decisions are appended with `LearnerModelStore.appendEvidence`. An `answer_assessment` is Evidence by construction and is recorded without the gate.
7. At `session_end` or idle the backend calls `LearnerModelStore.dream`.

Layout choice stays in the browser and is not a backend action. `createTimeline` and the WebSocket messages live here because every module's tests and the app's two halves share them.

Every `DecisionService` question may return `null` ("no decision"); callers then take the safe default and carry on.
