# Aha

A coding agent that builds the user's project as usual and turns moments of confusion into short lessons grounded in the user's own code.

## Learning moments

**Impasse**:
A moment when the user needs to understand something to move on. It starts when the user asks (the Why button on an agent change, or a question sent with Ask why) or when the same gap keeps recurring.
_Avoid_: stuck point, error, failure

**Offer**:
A light, skippable suggestion to start a lesson at an impasse the system detected. Declining an offer is never evidence about the user.
_Avoid_: prompt, interruption, popup

**Lesson**:
The short sequence that follows an accepted impasse: Probe, Explain, Articulate, then back to work. Only one Lesson runs at a time, in learning mode; the user's messages during it are follow-up questions inside it, and Back to work leaves it early without evidence.
_Avoid_: tutorial, teaching session

**Mode**:
What the session is doing, always exactly one at a time: **work mode**, where the agent builds, or **learning mode**, where one Lesson runs. Starting a Lesson enters learning mode; finishing it or pressing Back to work returns to work mode.
_Avoid_: state, phase, screen

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
One of five ordered states of a concept: not encountered, seen an explanation, correct with hints, explains independently, catches the agent's mistakes. Dreaming sets it from evidence alone and never lowers it. One piece of evidence reaches at most correct with hints; each of the top two levels needs two positive pieces, one of the matching kind.
_Avoid_: score, proficiency

**Learner Context**:
The slice of the learner model the read gate picks as relevant to the current impasse; it reaches the lesson and, through the bridge extension, the agent.
_Avoid_: user profile, memory context

**Dreaming**:
The background consolidation of the learner model after a session or during idle time: merging concepts, updating mastery levels and logging changes.
_Avoid_: memory sync, summarization

## Work

**Grounding**:
An explanation is grounded when it cites real files in the user's project or the agent's latest change. Every explanation must pass the grounding check.
_Avoid_: relevance, accuracy

**Timeline**:
The single, agent-independent record of everything that happens in a session: messages, tool calls, file edits, errors and lesson cards.
_Avoid_: event log, transcript, history
