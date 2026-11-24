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

`id` is stable, lowercase kebab-case. `mastery` is one of the five levels in `@aha/contracts`. `related_files` contains project-relative paths when known. Evidence entries are appended under `sessions/<session-id>.md` and record observed behavior, outcome, strength, time, and source Timeline entries. Appending Evidence leaves Concept files unchanged; `readConcepts` joins session Evidence by Concept id. The Dreaming change log is added by issue #42. The Memory panel saves index and Concept Markdown; Concept edits set `user_edited: true` so Dreaming can protect them.

The seed list is in `src/seeds.ts`. The store creates the initial files on first read and leaves any existing model untouched.

Dreaming runs at session end or after five minutes of inactivity (`AHA_DREAM_IDLE_MS` can change the idle interval). It asks a restricted Pi session with read-only tools for duplicate Concept ids. The store validates those proposals, retains Evidence from merged Concepts through `merged_from`, and derives Mastery Levels from recorded behavioral Evidence. It rechecks `user_edited` before writing Concept files and appends one entry to `changelog.md` for every run. If Pi is unavailable, it records that duplicate detection was skipped and still consolidates the recorded Evidence.
