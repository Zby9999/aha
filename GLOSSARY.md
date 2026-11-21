# Aha

A coding agent that builds the user's project as usual and turns moments of confusion into short lessons grounded in the user's own code.

## Learning moments

**Impasse**:
A moment when the user needs to understand something to move on. It starts when the user asks (the Why button, or a message sent with Ask why on) or when the same gap keeps recurring.
_Avoid_: stuck point, error, failure

**Offer**:
A light, skippable suggestion to start a lesson at an impasse the system detected. Declining an offer is never evidence about the user.
_Avoid_: prompt, interruption, popup

**Lesson**:
The short sequence that follows an accepted impasse: Probe, Explain, Articulate, then back to work.
_Avoid_: tutorial, teaching session

**Probe**:
The prediction or choice the user makes before an explanation, which exposes the specific gap.
_Avoid_: quiz, test

**Articulation**:
The user's own restatement of the idea, or their judgment of whether the agent's fix addresses the cause.
_Avoid_: summary, reflection

## Learner model

**Learner Model**:
The per-user, per-project record of which concepts the user understands, each backed by evidence. The user can read and edit it.
_Avoid_: memory, learner memory, profile

**Concept**:
One unit of understanding tracked in the learner model, such as routing or authentication.
_Avoid_: skill, topic, knowledge point

**Evidence**:
An observed behavior that says something about the user's understanding of a concept, such as a prediction result or catching the agent's mistake. Self-report is not evidence.
_Avoid_: signal, score

**Mastery Level**:
One of five ordered states of a concept: not encountered, seen an explanation, correct with hints, explains independently, catches the agent's mistakes.
_Avoid_: score, proficiency

**Dreaming**:
The background consolidation of the learner model after a session or during idle time: merging concepts, updating mastery levels and logging changes.
_Avoid_: memory sync, summarization

## Work

**Timeline**:
The single, agent-independent record of everything that happens in a session: messages, tool calls, file edits, errors and lesson cards.
_Avoid_: event log, transcript, history
