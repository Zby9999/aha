---
id: session-tokens
name: Session tokens identify a visitor across requests
mastery: catches_agent_mistakes
related_files:
  - public/app.js
  - server.js
user_edited: false
---

# Session tokens identify a visitor across requests

## Evidence

- ev-1 · repeated gap · negative · moderate · [demo-1:12](../sessions/demo-1.md#ev-1): The same 401 came back after two agent fixes and the user asked for a fix again.
- ev-3 · probe result · negative · moderate · [demo-1:24](../sessions/demo-1.md#ev-3): Predicted that sessionToken stays the same after a refresh.
- ev-4 · articulation · positive · strong · [demo-1:28](../sessions/demo-1.md#ev-4): Explained in their own words that a refresh makes a new token the server does not know.
- ev-7 · fix judgement · positive · strong · [demo-1:45](../sessions/demo-1.md#ev-7): Judged that the agent's localStorage fix hid the symptom without fixing the cause.
