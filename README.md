# Aha

A coding agent for novice vibe coders that turns moments of confusion into short lessons grounded in the user's own code. See `AGENTS.md`, `GLOSSARY.md` and `docs/adr/`.

## Development

Requires Node 24+ and pnpm 10 (`corepack enable` picks the pinned version).

```bash
corepack pnpm install --frozen-lockfile
pnpm typecheck      # type-check every package
pnpm check          # typecheck + tests, as CI runs them
pnpm --filter @aha/aha start   # build the UI and open the app at http://localhost:4317
```

`pnpm --filter @aha/aha start` replays the demo session (`@aha/contracts/fixtures`) through the stub modules and stops at the first Offer. Each module can be switched between `stub` and `real` in `apps/aha/aha.config.json` or with `AHA_<MODULE>=real` (ADR-0003). `AHA_REPLAY=off` starts with an empty Timeline; `AHA_PROJECT_DIR` points at another project.

To generate Lesson questions and explanations using your configured Pi model, set both `AHA_TEACHING=real` and `AHA_BACKGROUND=real`. `AHA_TEACHING=real` with a stub background runs the deterministic Lesson used for local replay and browser tests.

With Aha running, open the [lesson card gallery](http://127.0.0.1:4317/gallery.html) to try each Teaching component using the portfolio examples. Gallery actions only affect the preview.

| Package | Module | Owner |
|---|---|---|
| `packages/contracts` | Shared types and fixtures | everyone |
| `packages/agent-host` | 1 Agent Host | Bingyi |
| `packages/app` | 2 App Shell | Zeng |
| `packages/decisions` | 3 Decision Layer | He |
| `packages/learner-model` | 4 Learner Model | Jingyi |
| `packages/teaching` | 5 Teaching & GenUI | Junchi |
| `apps/aha` | Composition root: config, wiring, session-replay test | Zeng |

Module packages depend only on `@aha/contracts` (ADR-0002); `tests/module-boundaries.test.ts` enforces it. Packages export TypeScript source directly, so there is no build step between them.
