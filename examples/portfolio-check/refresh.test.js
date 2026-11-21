// Drives the example portfolio project like a user would: log in, add a
// project, refresh the page, log in again, then look at the project list.
//
// By default it asserts the seeded bug is still there (the project is gone).
// To check a fixed copy instead:
//   PORTFOLIO_DIR=/path/to/fixed/copy EXPECT_FIXED=1 npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { JSDOM, CookieJar } = require('jsdom');

const PORTFOLIO_DIR = process.env.PORTFOLIO_DIR || path.join(__dirname, '..', 'portfolio');
const EXPECT_FIXED = process.env.EXPECT_FIXED === '1';

// Demo account from examples/portfolio/server.js.
const USERNAME = 'alex';
const PASSWORD = 'portfolio123';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check, what, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: PORTFOLIO_DIR,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const url = `http://localhost:${port}/`;
  try {
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`server.js exited:\n${stderr}`);
      return fetch(url).then((r) => r.ok, () => false);
    }, 'the portfolio server to start');
  } catch (error) {
    child.kill();
    throw error;
  }
  return { url, stop: () => child.kill() };
}

// One browser tab. `storage` and `cookieJar` carry over between page loads,
// the way a real browser keeps localStorage and cookies across a refresh.
async function openPage(url, browser) {
  const dom = await JSDOM.fromURL(url, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    cookieJar: browser.cookieJar,
    beforeParse(window) {
      for (const [key, value] of browser.storage) window.localStorage.setItem(key, value);
      window.fetch = async (input, init = {}) => {
        const target = new URL(input, window.location.href).href;
        const headers = new Headers(init.headers);
        const cookie = await browser.cookieJar.getCookieString(target);
        if (cookie) headers.set('cookie', cookie);
        const response = await fetch(target, { ...init, headers });
        for (const setCookie of response.headers.getSetCookie()) {
          await browser.cookieJar.setCookie(setCookie, target);
        }
        return response;
      };
    },
  });
  const { document } = dom.window;
  const visible = (id) => !document.getElementById(id).hidden;

  await new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else dom.window.addEventListener('load', resolve);
  });
  await waitFor(() => visible('login') || visible('portfolio'), 'the page to finish loading');

  return {
    visible,
    async logIn() {
      document.getElementById('username').value = USERNAME;
      document.getElementById('password').value = PASSWORD;
      document.getElementById('login-form').requestSubmit();
      await waitFor(() => visible('portfolio'), 'login to finish');
    },
    async addProject(title) {
      document.getElementById('project-title').value = title;
      document.getElementById('project-description').value = 'A project added by the check';
      document.getElementById('project-form').requestSubmit();
      await waitFor(() => this.projectTitles().includes(title), `"${title}" to appear`);
    },
    projectTitles() {
      return [...document.querySelectorAll('#projects h3')].map((h) => h.textContent);
    },
    close() {
      browser.storage = Object.entries({ ...dom.window.localStorage });
      dom.window.close();
    },
  };
}

test(
  EXPECT_FIXED
    ? 'projects added after login survive a page refresh'
    : 'seeded bug: projects added after login are gone after a page refresh',
  async (t) => {
    const server = await startServer();
    t.after(server.stop);
    const browser = { cookieJar: new CookieJar(), storage: [] };

    const first = await openPage(server.url, browser);
    assert.ok(first.visible('login'), 'a new visitor sees the login form');
    await first.logIn();
    await first.addProject('Weather app');
    assert.deepEqual(first.projectTitles(), ['Weather app']);
    first.close();

    // Refresh. If the page asks to log in again, do it, as a user would.
    const second = await openPage(server.url, browser);
    if (second.visible('login')) await second.logIn();
    const titles = second.projectTitles();
    second.close();

    if (EXPECT_FIXED) assert.deepEqual(titles, ['Weather app']);
    else assert.deepEqual(titles, [], 'the bug no longer reproduces');
  },
);
