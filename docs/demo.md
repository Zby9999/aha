# Running the demo

The live demo for #13: build on the portfolio site with your own Pi, get a grounded Lesson, see Evidence reach the Learner Model, and get a shorter Lesson on the next related Impasse. Every module runs its real implementation. A run costs model credits (your Pi's default model) and Jev calls.

## Prepare (once)

1. Install Node 24 or later, then run `pnpm install` at the repo root.
2. Install Pi and log in to a model provider. Check that the provider is ready:
   ```bash
   npm install -g @earendil-works/pi-coding-agent
   ```
   ```bash
   pi auth login <provider>
   ```
   ```bash
   pi auth check --provider <provider>
   ```
3. Put the Jev key in `.env.local` at the repo root as `TYPESAFE_API_KEY=...`. The start script loads this file, and git ignores it. Without a key Aha still works as a coding agent, but you get no Offers and no Learner Context.

## Use a copy of the example project

Pi edits the project, and the Learner Model writes `<project>/.aha/`. Run on a copy so the repo stays clean:

```bash
rm -rf /tmp/aha-demo && cp -R examples/portfolio /tmp/aha-demo && rm -rf /tmp/aha-demo/node_modules /tmp/aha-demo/.aha
```

```bash
(cd /tmp/aha-demo && npm install)
```

To start over with an empty Learner Model, delete `/tmp/aha-demo/.aha`.

## Start

```bash
AHA_AGENT_HOST=real AHA_DECISIONS=real AHA_LEARNER_MODEL=real AHA_TEACHING=real AHA_BACKGROUND=real AHA_DREAM_IDLE_MS=30000 AHA_PROJECT_DIR=/tmp/aha-demo pnpm --filter @aha/aha start
```

Open http://127.0.0.1:4317. The Preview tab shows the portfolio at http://localhost:4318 (log in as `alex` / `portfolio123`).

`AHA_DREAM_IDLE_MS=30000` runs Dreaming after 30 seconds without activity instead of the default five minutes, so a mastery change shows up during the demo. Dreaming also runs when you stop Aha with Ctrl-C. A second Ctrl-C quits at once.

## Script

| # | Do | You should see |
|---|---|---|
| 1 | Send: *I added a login to my portfolio, but every time I refresh the page I'm logged out. Can you fix it?* | Pi reads the code and edits `public/app.js` so the token survives a refresh. The edit appears as a change card. |
| 2 | Send: *Refresh works now, but when I log out and log back in, my projects are gone. Can you fix that too?* | Pi edits `server.js` so projects belong to the user. If Jev sees the same gap twice, an **Offer** appears; accept it and skip to step 4. |
| 3 | Press **Why?** on the agent's `public/app.js` (or `server.js`) change. | A Lesson starts: a **Probe** asks you to predict what happens. |
| 4 | Type a prediction, e.g. *They stay logged in, because the token is still there.* | An **Explain** card: a data-flow diagram or text with code references from your project. Then an **Articulation** card. |
| 5 | Explain the cause in your own words, e.g. *The page reads the saved token from localStorage and sends it in X-Session-Token, so the server finds the same session.* | The Lesson completes. The Memory tab's `sessions/local-….md` gets an Evidence entry for *session-tokens*, assessed correct or partial. |
| 6 | Wait about 30 seconds. | Dreaming runs. `changelog.md` shows *session-tokens: not_encountered → correct_with_hints*, and so does the concept file. |
| 7 | Turn on **Ask why** and send: *Why does the server need the session token on every request?* Or press Why on another token-related change. | An **adapted Lesson** with no Probe: a short answer to the question (or, for Why on a change, a hint that points to the lines to check), then a one-sentence **Articulation**. A correct answer is strong Evidence; two of them take a Concept to *explains_independently*. |
| 8 | Ctrl-C in the terminal. | *Ending the session: updating the learner model…* Dreaming runs once more, then Aha exits. |

Pi's replies vary from run to run. If Pi reports that a change is already done, ask for a different one, e.g. *In server.js, make a session token stop working one hour after login.* Then press Why on that change.

## When something fails

Learning features never block the work. Chat with the agent keeps working in every case below; `apps/aha/test/learning-failures.test.ts` covers the first four.

| Problem | What happens |
|---|---|
| No Jev key, Jev times out, answers 401, or is unreachable | No Offers and no Learner Context. Jev logs one warning per cause. |
| Background Pi not logged in or failing | Why and Ask why show *Couldn't prepare this Lesson. Try Why again.* and return to work mode. Dreaming logs *Restricted Pi unavailable* and skips duplicate detection. |
| A Lesson step times out (slow model) | The card shows *Couldn't prepare the next step.* Press **Retry**, or go back to work. |
| Pi is missing or not logged in at start | Aha exits with a message saying what to run. |
