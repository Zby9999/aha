const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// The accounts that can log in. (Just one for now.)
const users = {
  alex: 'portfolio123',
};

// Everyone who is logged in right now, looked up by their session token.
const sessions = {};
let nextProjectId = 1;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getSession(req) {
  return sessions[req.get('X-Session-Token')];
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!users[username] || users[username] !== password) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  const token = req.get('X-Session-Token');
  if (!token) {
    return res.status(400).json({ error: 'Missing session token' });
  }

  sessions[token] = { username, projects: [] };
  res.json({ username, projects: [] });
});

app.get('/api/me', (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  res.json({ username: session.username, projects: session.projects });
});

app.post('/api/projects', (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const { title, description, link } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'A project needs a title' });
  }

  const project = {
    id: nextProjectId++,
    title,
    description: description || '',
    link: link || '',
  };
  session.projects.push(project);
  res.status(201).json(project);
});

app.post('/api/logout', (req, res) => {
  delete sessions[req.get('X-Session-Token')];
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Portfolio running at http://localhost:${PORT}`);
});
