// A random id for this visitor. The server uses it to remember who is logged in.
const sessionToken = Math.random().toString(36).slice(2);

const loginSection = document.getElementById('login');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');
const portfolioSection = document.getElementById('portfolio');
const currentUser = document.getElementById('current-user');
const projectList = document.getElementById('projects');
const projectForm = document.getElementById('project-form');
const titleInput = document.getElementById('project-title');
const descriptionInput = document.getElementById('project-description');
const linkInput = document.getElementById('project-link');
const projectError = document.getElementById('project-error');
const logoutButton = document.getElementById('logout');

// Calls our server and sends the session token along with every request.
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': sessionToken,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error);
  }
  return data;
}

function showLogin() {
  portfolioSection.hidden = true;
  loginSection.hidden = false;
}

function showPortfolio(user) {
  loginSection.hidden = true;
  portfolioSection.hidden = false;
  currentUser.textContent = user.username;
  projectList.innerHTML = '';
  user.projects.forEach(addProjectToList);
  if (user.projects.length === 0) {
    projectList.innerHTML = '<li class="empty">No projects yet. Add your first one below!</li>';
  }
}

function addProjectToList(project) {
  const empty = projectList.querySelector('.empty');
  if (empty) {
    empty.remove();
  }

  const item = document.createElement('li');
  const title = document.createElement('h3');
  title.textContent = project.title;
  item.appendChild(title);

  if (project.description) {
    const description = document.createElement('p');
    description.textContent = project.description;
    item.appendChild(description);
  }

  if (project.link) {
    const link = document.createElement('a');
    link.href = project.link;
    link.textContent = 'See it live';
    item.appendChild(link);
  }

  projectList.appendChild(item);
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    const user = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
      }),
    });
    loginForm.reset();
    showPortfolio(user);
  } catch (error) {
    loginError.textContent = error.message;
  }
});

projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  projectError.textContent = '';
  try {
    const project = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        title: titleInput.value,
        description: descriptionInput.value,
        link: linkInput.value,
      }),
    });
    projectForm.reset();
    addProjectToList(project);
  } catch (error) {
    projectError.textContent = error.message;
  }
});

logoutButton.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

// When the page opens, ask the server if we are already logged in.
api('/api/me').then(showPortfolio).catch(showLogin);
