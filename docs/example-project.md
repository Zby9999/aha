# Example project: the portfolio site

The demo scenario, every module's fixtures and the final demo all use one example project: `examples/portfolio/`, a small portfolio site written the way a novice vibe coder would write it (Express backend, plain HTML and JavaScript front end, no framework). It has one seeded bug: **after you log in and refresh the page, your projects are gone.**

This note is for the team. It explains the bug and its fix, so it lives here and not inside `examples/portfolio/`. Nothing inside the project states the cause; its comments are the kind a novice would write, so Pi and the user have to work it out.

## Run it

```bash
cd examples/portfolio && npm install && npm start
```

Open http://localhost:3000 and log in as `alex` / `portfolio123` (a demo account hard-coded in `server.js`; not a real credential). `PORT` overrides the port.

## Reproduce the bug

1. Open the page. You see the login form.
2. Log in as `alex` / `portfolio123`.
3. Add a project, e.g. title "Weather app". It appears under "My projects".
4. Refresh the page. You are back at the login form, and the browser console shows `GET /api/me 401 (Unauthorized)`.
5. Log in again. "My projects" says "No projects yet". The project is gone.

It reproduces every time, in any browser. Restarting the server also wipes everything (the data is only in memory); that is expected and is not the bug the demo is about.

Automated check: `examples/portfolio-check/` drives the real page in jsdom through the same steps and asserts the project is gone.

```bash
cd examples/portfolio && npm install && cd ../portfolio-check && npm install && npm test
```

## Cause

Two pieces of code work together to lose the data:

- `public/app.js` makes a new random `sessionToken` at the top of the file every time the script runs, which is every page load. The token lives only in a JavaScript variable, so a refresh throws it away and makes a new one.
- `server.js` stores each logged-in user's data under that token (`sessions[token] = { username, projects: [] }` in the `/api/login` route, looked up in `getSession`). The projects belong to the token, not to the user.

After a refresh the browser sends a token the server has never seen, so `GET /api/me` answers 401 and the page shows the login form. Logging in again creates a fresh, empty session under the new token. The old projects are still in server memory, but nothing points to them any more. Logging out and back in without a refresh loses them too, because login overwrites the session for the same token.

The concepts a lesson can build on: a page reload restarts the page's JavaScript and forgets its variables; a session token is how the server recognises the same visitor across requests, so it must survive across page loads; data should belong to the user, not to one login session.

## Intended fix

Make the server create the token at login, keep it in the browser across page loads, and store projects by username:

```diff
--- a/server.js
+++ b/server.js
@@ -1,3 +1,4 @@
+const crypto = require('crypto');
 const path = require('path');
 const express = require('express');
 
@@ -9,15 +10,18 @@
   alex: 'portfolio123',
 };
 
-// Everyone who is logged in right now, looked up by their session token.
+// Who is logged in: session token -> username.
 const sessions = {};
+// Each user's projects: username -> list of projects.
+const portfolios = {};
 let nextProjectId = 1;
 
 app.use(express.json());
 app.use(express.static(path.join(__dirname, 'public')));
 
 function getSession(req) {
-  return sessions[req.get('X-Session-Token')];
+  const username = sessions[req.get('X-Session-Token')];
+  return username && { username, projects: portfolios[username] };
 }
 
 app.post('/api/login', (req, res) => {
@@ -26,13 +29,10 @@
     return res.status(401).json({ error: 'Wrong username or password' });
   }
 
-  const token = req.get('X-Session-Token');
-  if (!token) {
-    return res.status(400).json({ error: 'Missing session token' });
-  }
-
-  sessions[token] = { username, projects: [] };
-  res.json({ username, projects: [] });
+  const token = crypto.randomUUID();
+  sessions[token] = username;
+  portfolios[username] = portfolios[username] || [];
+  res.json({ token, username, projects: portfolios[username] });
 });
 
 app.get('/api/me', (req, res) => {
```

```diff
--- a/public/app.js
+++ b/public/app.js
@@ -1,5 +1,5 @@
-// A random id for this visitor. The server uses it to remember who is logged in.
-const sessionToken = Math.random().toString(36).slice(2);
+// The server gives us a token when we log in. Keep it so a refresh stays logged in.
+let sessionToken = localStorage.getItem('sessionToken');
 
 const loginSection = document.getElementById('login');
 const loginForm = document.getElementById('login-form');
@@ -86,6 +86,8 @@
         password: passwordInput.value,
       }),
     });
+    sessionToken = user.token;
+    localStorage.setItem('sessionToken', sessionToken);
     loginForm.reset();
     showPortfolio(user);
   } catch (error) {
@@ -114,6 +116,8 @@
 
 logoutButton.addEventListener('click', async () => {
   await api('/api/logout', { method: 'POST' });
+  localStorage.removeItem('sessionToken');
+  sessionToken = null;
   showLogin();
 });
```

The smallest fix that stops the symptom is front-end only: read the token from `localStorage` and only generate (and save) a new one when there is none. It works for refresh, but the data still belongs to one token, so it is lost after logging out and back in, and the browser still invents its own session id. Treat it as a partial fix.

A wrong fix to watch for (a good moment for the user to catch the agent's mistake): saving the projects themselves in `localStorage`. The list survives a refresh, but the server no longer has the user's data, it does not follow the user to another browser, and the session bug is still there.

Not part of the scenario: `public/app.js` puts the project link straight into `href`, so a `javascript:` link would run when clicked. It is realistic novice code and is left in; if Pi raises it, it is a side issue, not the seeded bug.

To verify a fix, apply it to a copy of the project and run the check against the copy:

```bash
cd examples/portfolio-check && PORTFOLIO_DIR=/path/to/fixed/copy EXPECT_FIXED=1 npm test
```

Both the intended fix and the smallest fix above pass this check. The check needs Node 20 or newer. It finds elements by their ids (`login`, `portfolio`, `login-form`, `username`, `password`, `project-form`, `project-title`, `project-description`, `projects`), so a fix must keep those.

## Demo script

Copy `examples/portfolio/` to a fresh folder outside this repo before the demo (so Pi cannot read this note), run `npm install`, and open that folder in Aha.

The demo does not need the agent to fail. It needs two related impasses, so the second Lesson can adapt to what the first one taught. A strong model may fix everything at once if it hears the whole symptom, so the first message describes only the logout:

> I added a login to my portfolio, but every time I refresh the page I'm logged out. Can you fix it?

1. **First fix and first impasse.** The agent most likely keeps the token in `localStorage` (the partial fix). Refresh now works. The user presses **Why** on the change and gets a Lesson on why a page reload forgets JavaScript variables and why the session token must survive it.
2. **Second impasse.** The user logs out, logs back in, and the projects are gone again. They ask the agent about it, or the repeated symptom triggers an Offer. The Lesson is about data belonging to the user rather than to one login session, and it should be shorter or start from a Probe, because the learner model now records the first Lesson.
3. **Articulation.** The user judges whether the agent's next change fixes the cause.

If the agent goes straight to the intended fix, step 2 has no live symptom: the user still presses Why on the fix, and adaptation is shown with the replayed fixture session. If the agent saves the projects themselves in `localStorage` (the wrong fix above), use step 3 to let the user catch it; catching the agent's mistake is the highest Mastery Level.

## File paths

Fixtures refer to files by their path relative to the project root, and to code by symbol (`sessionToken`, `getSession`, `sessions`) rather than line number. These names are stable:

| Path | What it is |
|---|---|
| `package.json` | `npm start` runs `node server.js`; depends on Express 5 |
| `package-lock.json` | Locked dependency versions |
| `README.md` | The novice's own readme: how to run, demo login |
| `server.js` | Express server: login, `/api/me`, `/api/projects`, logout; the in-memory `sessions` store |
| `public/index.html` | The page: login form and portfolio section |
| `public/app.js` | Front-end code: the per-page-load `sessionToken`, API calls, rendering |
| `public/style.css` | Styles |

In the repo they live under `examples/portfolio/` (for example `examples/portfolio/public/app.js`).
