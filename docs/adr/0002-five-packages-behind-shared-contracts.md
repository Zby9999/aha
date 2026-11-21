# Five packages that meet only through shared contracts

With six days of build time and five people working in parallel, we split the code into five packages (agent-host, app, decisions, learner-model, teaching) in a pnpm TypeScript monorepo, and let them depend only on `packages/contracts`: shared types plus fixtures recorded from the example project. Each package is built and tested against those fixtures, without waiting for the others; the Timeline is the only runtime data every package shares.

## Consequences

- Changing a contract is a cross-team change and goes through a PR that every affected owner reviews.
- Until real recordings exist, fixtures are hand-written and may drift from what Pi actually emits; they are replaced by recordings once the agent host runs.
