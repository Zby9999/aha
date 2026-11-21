# Aha

A coding agent for novice vibe coders. It works like an ordinary coding agent and turns moments of confusion into short, project-grounded lessons, using a learner model built from the user's own behavior.

Course project for CityU SYE6601. Design notes and reports live outside this repo; decisions that affect the code are recorded in `docs/adr/`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `Zby9999/aha`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Team workflow

Each teammate owns one module; pick an unblocked sub-ticket labelled with your `owner:` label, branch from `main`, run `/implement #<issue>`, and open a PR that closes the issue. See `docs/workflow.md`. The `implement`, `tdd`, `code-review`, `codebase-design` and `diagnosing-bugs` skills are vendored in `.agents/skills/`.
