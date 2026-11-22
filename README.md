# Aha

A coding agent for novice vibe coders that turns moments of confusion into short lessons grounded in the user's own code. See `AGENTS.md`, `GLOSSARY.md` and `docs/adr/`.

## Development

Requires Node 24+ and pnpm 10 (`corepack enable` picks the pinned version).

```bash
pnpm install-test   # install everything and run all tests
pnpm typecheck      # type-check every package
pnpm check          # typecheck + tests, as CI runs them
pnpm --filter @aha/aha start   # build the UI and open the app at http://localhost:4317
```

`pnpm --filter @aha/aha start` replays the demo session (`@aha/contracts/fixtures`) through the stub modules and stops at the first Offer. Each module can be switched between `stub` and `real` in `apps/aha/aha.config.json` or with `AHA_<MODULE>=real` (ADR-0003). `AHA_REPLAY=off` starts with an empty Timeline; `AHA_PROJECT_DIR` points at another project.

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
