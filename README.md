# Aha

A coding agent for novice vibe coders that turns moments of confusion into short lessons grounded in the user's own code. See `AGENTS.md`, `GLOSSARY.md` and `docs/adr/`.

## Development

Requires Node 24+ and pnpm 10 (`corepack enable` picks the pinned version).

```bash
pnpm install-test   # install everything and run all tests
pnpm typecheck      # type-check every package
pnpm check          # typecheck + tests, as CI runs them
```

| Package | Module | Owner |
|---|---|---|
| `packages/contracts` | Shared types and fixtures | everyone |
| `packages/agent-host` | 1 Agent Host | Bingyi |
| `packages/app` | 2 App Shell | Zeng |
| `packages/decisions` | 3 Decision Layer | He |
| `packages/learner-model` | 4 Learner Model | Jingyi |
| `packages/teaching` | 5 Teaching & GenUI | Junchi |

Module packages depend only on `@aha/contracts` (ADR-0002); `tests/module-boundaries.test.ts` enforces it. Packages export TypeScript source directly, so there is no build step between them.
