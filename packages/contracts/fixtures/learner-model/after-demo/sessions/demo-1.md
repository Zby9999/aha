# Session demo-1

Evidence appended during the session, in order. Concept files are rewritten only by Dreaming.

## ev-1
- concept: session-tokens
- type: repeated_gap · outcome: negative · strength: moderate
- entries: demo-1:93, demo-1:94, demo-1:148
- at: 2026-11-21T10:01:30.000Z
- note: The same 401 came back after two agent fixes and the user asked for a fix again.

## ev-2
- concept: page-reload-resets-state
- type: probe_result · outcome: negative · strength: moderate
- entries: demo-1:154, demo-1:155
- at: 2026-11-21T10:02:05.000Z
- note: Predicted that sessionToken stays the same after a refresh.

## ev-3
- concept: session-tokens
- type: probe_result · outcome: negative · strength: moderate
- entries: demo-1:154, demo-1:155
- at: 2026-11-21T10:02:05.000Z
- note: Predicted that sessionToken stays the same after a refresh.

## ev-4
- concept: session-tokens
- type: articulation · outcome: positive · strength: strong
- entries: demo-1:158, demo-1:159
- at: 2026-11-21T10:02:25.000Z
- note: Explained in their own words that a refresh makes a new token the server does not know.

## ev-5
- concept: page-reload-resets-state
- type: articulation · outcome: positive · strength: strong
- entries: demo-1:158, demo-1:159
- at: 2026-11-21T10:02:25.000Z
- note: Explained in their own words that a refresh runs app.js again.

## ev-6
- concept: data-belongs-to-user
- type: probe_result · outcome: positive · strength: moderate
- entries: demo-1:246, demo-1:247
- at: 2026-11-21T10:03:35.000Z
- note: Predicted that the projects stay in portfolios[username] after logging out and in.

## ev-7
- concept: session-tokens
- type: fix_judgement · outcome: positive · strength: strong
- entries: demo-1:249, demo-1:250
- at: 2026-11-21T10:03:50.000Z
- note: Judged that the agent's localStorage fix hid the symptom without fixing the cause.

## ev-8
- concept: data-belongs-to-user
- type: fix_judgement · outcome: positive · strength: strong
- entries: demo-1:249, demo-1:250
- at: 2026-11-21T10:03:50.000Z
- note: Judged that the agent's localStorage fix hid the symptom without fixing the cause.
