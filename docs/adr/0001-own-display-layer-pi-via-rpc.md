# Own display layer, with the user's Pi behind an RPC adapter

Aha must both build and teach, so the coding agent has to be strong and keep up with Pi releases, while teaching needs a UI on the same screen as the work. We build our own web UI and backend (modelled on Paseo's architecture) and run the user's installed Pi in RPC mode behind an agent adapter that turns its events into the Timeline. Our decisions (impasse detection, evidence gating, component choice, grounding) only observe the event stream, so they do not need to live inside the agent loop.

## Considered Options

- Embed Pi via its SDK: richest events, but pins our Pi version and runs user extensions in our process. Kept only for background agents.
- Ship a Pi extension package: novices will not install Pi plus extensions, and a terminal cannot render lesson UI.
- ACP client: the host cannot see inside the agent loop; a possible future adapter.
- MCP server only: cannot see user messages, diffs or errors, so it cannot collect evidence or detect impasses.
- Paseo plugin: limited by the plugin API (events pulled per turn, best-effort delivery).
