# Learner model Markdown format

The model lives at `.aha/learner-model/` inside each project. `index.md` links to one file per Concept in `concepts/`. A new project receives 35 common web-app Concepts, each at `not_encountered`. Seeds are a vocabulary for later Evidence, never a claim that the user understands a Concept.

Each Concept file begins with these fields:

```md
---
id: session-tokens
name: Session tokens identify a visitor across requests
mastery: not_encountered
related_files: []
user_edited: false
---

# Session tokens identify a visitor across requests

## Evidence

No evidence yet.
```

`id` is stable, lowercase kebab-case. `mastery` is one of the five levels in `@aha/contracts`. `related_files` contains project-relative paths when known. Evidence entries will link to the session log under `sessions/` and record the observed behavior, outcome, strength, and source Timeline entries. The session log and Dreaming change log are added by issues #39 and #42. User edits take priority over generated updates; issue #40 adds the edit path.

The seed list is in `src/seeds.ts`. The store creates the initial files on first read and leaves any existing model untouched.
