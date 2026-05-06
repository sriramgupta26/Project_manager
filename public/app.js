const state = {
  token: localStorage.getItem("ttm_token") || "",
  user: null,
  users: [],
  projects: [],
  tasks: [],
  dashboard: null,
  taskFilters: {
    query: "",
    status: "all",
    projectId: "all"
  },
  view: "dashboard",
  message: ""
};

const statusLabels = {
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done"
};

const app = document.querySelector("#app");

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setMessage(message, type = "error") {
  state.message = message ? `<div class="message ${type}">${escapeHtml(message)}</div>` : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function boot() {
  if (!state.token) return renderAuth();
  try {
    const { user } = await api("/api/me");
    state.user = user;
    await refresh();
    renderApp();
  } catch {
    logout();
  }
}

async function refresh() {
  const [users, projects, tasks, dashboard] = await Promise.all([
    api("/api/users"),
    api("/api/projects"),
    api("/api/tasks"),
    api("/api/dashboard")
  ]);
  state.users = users.users;
  state.projects = projects.projects;
  state.tasks = tasks.tasks;
  state.dashboard = dashboard;
}

function renderAuth(mode = "login") {
  app.innerHTML = `
    <section class="auth">
      <form class="auth-panel" id="authForm">
        <div>
          <h1>Team Task Manager</h1>
          <p>${mode === "login" ? "Log in to manage projects and delivery work." : "Create the first account as Admin, then invite members."}</p>
        </div>
        ${state.message}
        ${mode === "signup" ? '<label>Name<input name="name" autocomplete="name" required minlength="2" /></label>' : ""}
        <label>Email<input name="email" type="email" autocomplete="email" required /></label>
        <label>Password<input name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required minlength="8" /></label>
        <button>${mode === "login" ? "Login" : "Create account"}</button>
        <button class="secondary" type="button" id="swapAuth">${mode === "login" ? "Need an account?" : "Already have an account?"}</button>
      </form>
    </section>
  `;
  document.querySelector("#swapAuth").onclick = () => {
    setMessage("");
    renderAuth(mode === "login" ? "signup" : "login");
  };
  document.querySelector("#authForm").onsubmit = async (event) => {
    event.preventDefault();
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const payload = await api(endpoint, { method: "POST", body: JSON.stringify(formData(event.target)) });
      state.token = payload.token;
      state.user = payload.user;
      localStorage.setItem("ttm_token", state.token);
      setMessage("");
      await refresh();
      renderApp();
    } catch (error) {
      setMessage(error.message);
      renderAuth(mode);
    }
  };
}

function renderApp() {
  app.innerHTML = `
    <section class="shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>Team Task Manager</h1>
          <p>${escapeHtml(state.user.name)} · ${state.user.role}</p>
        </div>
        <nav class="nav">
          ${navButton("dashboard", "Dashboard")}
          ${navButton("projects", "Projects")}
          ${navButton("tasks", "Tasks")}
          ${navButton("team", "Team")}
          <button id="logout">Logout</button>
        </nav>
      </aside>
      <section class="content">
        <div class="topbar">
          <div>
            <h2>${titleForView()}</h2>
            <div class="userline">${escapeHtml(state.user.email)}</div>
          </div>
          <button class="secondary" id="refresh">Refresh</button>
        </div>
        ${state.message}
        ${renderView()}
      </section>
    </section>
  `;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => {
      state.view = button.dataset.view;
      setMessage("");
      renderApp();
    };
  });
  document.querySelector("#logout").onclick = logout;
  document.querySelector("#refresh").onclick = async () => {
    await refresh();
    renderApp();
  };
  bindViewHandlers();
}

function navButton(view, label) {
  return `<button class="${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`;
}

function titleForView() {
  return {
    dashboard: "Dashboard",
    projects: "Projects",
    tasks: "Tasks",
    team: "Team"
  }[state.view];
}

function renderView() {
  if (state.view === "projects") return renderProjects();
  if (state.view === "tasks") return renderTasks();
  if (state.view === "team") return renderTeam();
  return renderDashboard();
}

function renderDashboard() {
  const d = state.dashboard;
  return `
    <div class="grid three">
      ${stat("Projects", d.totals.projects)}
      ${stat("All tasks", d.totals.tasks)}
      ${stat("Overdue", d.totals.overdue)}
    </div>
    <div class="grid two" style="margin-top:1rem">
      <section class="panel">
        <h3>Status</h3>
        <div class="stack">
          ${Object.entries(d.byStatus).map(([status, count]) => `<div class="row"><span class="pill ${status}">${statusLabels[status]}</span><strong>${count}</strong></div>`).join("")}
        </div>
      </section>
      <section class="panel">
        <h3>My open tasks</h3>
        ${taskList(d.myOpenTasks)}
      </section>
      <section class="panel">
        <h3>Overdue</h3>
        ${taskList(d.overdueTasks)}
      </section>
      <section class="panel">
        <h3>Progress</h3>
        <div class="stat"><strong>${d.totals.completed}</strong><span>Completed tasks</span></div>
      </section>
    </div>
  `;
}

function stat(label, value) {
  return `<section class="panel stat"><strong>${value}</strong><span>${label}</span></section>`;
}

function renderProjects() {
  return `
    <div class="grid two">
      <form class="panel form" id="projectForm">
        <h3>New project</h3>
        <label>Name<input name="name" required minlength="3" /></label>
        <label>Description<textarea name="description"></textarea></label>
        <label>Team members<select name="memberIds" multiple size="5">${userOptions()}</select></label>
        <button>Create project</button>
      </form>
      <section class="stack">
        ${state.projects.length ? state.projects.map(projectCard).join("") : '<div class="empty">No projects yet.</div>'}
      </section>
    </div>
  `;
}

function projectCard(project) {
  const progress = project.taskCount ? Math.round((project.completedTaskCount / project.taskCount) * 100) : 0;
  const members = project.memberIds.map((memberId) => state.users.find((user) => user.id === memberId)?.name).filter(Boolean).join(", ");
  return `
    <article class="card">
      <div class="row">
        <h3>${escapeHtml(project.name)}</h3>
        <span class="pill">${progress}% done</span>
      </div>
      <p>${escapeHtml(project.description || "No description")}</p>
      <div class="meta"><span>${project.taskCount} tasks</span><span>${escapeHtml(members || "No members")}</span></div>
      ${canManage(project) ? `<div class="actions" style="margin-top:.8rem"><button class="danger" data-delete-project="${project.id}">Delete</button></div>` : ""}
    </article>
  `;
}

function renderTasks() {
  const selectedProject = state.projects[0] || null;
  const canCreateTask = Boolean(selectedProject);
  const visibleTasks = filteredTasks();
  return `
    <div class="grid two">
      <form class="panel form" id="taskForm">
        <h3>New task</h3>
        ${canCreateTask ? "" : '<div class="message error">Create a project before adding tasks.</div>'}
        <label>Project<select name="projectId" id="projectSelect" required ${canCreateTask ? "" : "disabled"}>${projectOptions()}</select></label>
        <label>Title<input name="title" required minlength="3" /></label>
        <label>Description<textarea name="description"></textarea></label>
        <label>Assignee<select name="assigneeId" id="assigneeSelect" required ${canCreateTask ? "" : "disabled"}>${assigneeOptions(selectedProject?.id)}</select></label>
        <label>Status<select name="status">${statusOptions()}</select></label>
        <label>Due date<input name="dueDate" type="date" /></label>
        <button ${canCreateTask ? "" : "disabled"}>Create task</button>
      </form>
      <section class="task-board">
        <div class="panel filters">
          <label>Search<input id="taskSearch" value="${escapeHtml(state.taskFilters.query)}" placeholder="Search title, description, assignee" /></label>
          <label>Status<select id="taskStatusFilter">${filterStatusOptions()}</select></label>
          <label>Project<select id="taskProjectFilter">${filterProjectOptions()}</select></label>
        </div>
        <div class="stack">
          ${visibleTasks.length ? visibleTasks.map(taskCard).join("") : '<div class="empty">No tasks match the current filters.</div>'}
        </div>
      </section>
    </div>
  `;
}

function filteredTasks() {
  const query = state.taskFilters.query.trim().toLowerCase();
  return state.tasks.filter((task) => {
    const matchesStatus = state.taskFilters.status === "all" || task.status === state.taskFilters.status;
    const matchesProject = state.taskFilters.projectId === "all" || task.projectId === state.taskFilters.projectId;
    const haystack = [task.title, task.description, task.assigneeName, task.projectName].join(" ").toLowerCase();
    return matchesStatus && matchesProject && (!query || haystack.includes(query));
  });
}

function taskList(tasks) {
  return tasks.length ? `<div class="stack">${tasks.map(taskCard).join("")}</div>` : '<div class="empty">Nothing here right now.</div>';
}

function taskCard(task) {
  const overdue = task.dueDate && task.dueDate < today() && task.status !== "done";
  return `
    <article class="card task ${task.status === "done" ? "done" : ""} ${overdue ? "overdue" : ""}">
      <div class="row">
        <h3>${escapeHtml(task.title)}</h3>
        <span class="pill ${task.status}">${statusLabels[task.status]}</span>
      </div>
      <p>${escapeHtml(task.description || "No description")}</p>
      <div class="meta">
        <span>${escapeHtml(task.projectName)}</span>
        <span>${escapeHtml(task.assigneeName)}</span>
        <span>${task.dueDate ? `Due ${escapeHtml(task.dueDate)}` : "No due date"}</span>
      </div>
      <div class="actions" style="margin-top:.8rem">
        ${Object.keys(statusLabels).map((status) => `<button class="secondary" data-status="${status}" data-task="${task.id}">${statusLabels[status]}</button>`).join("")}
        <button class="danger" data-delete-task="${task.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderTeam() {
  return `
    <section class="panel">
      <h3>Members</h3>
      <div class="stack">
        ${state.users.map((user) => `
          <div class="row">
            <div>
              <strong>${escapeHtml(user.name)}</strong>
              <div class="meta"><span>${escapeHtml(user.email)}</span><span>${user.role}</span></div>
            </div>
            ${state.user.role === "Admin" && user.id !== state.user.id ? `
              <select data-role-user="${user.id}">
                <option ${user.role === "Member" ? "selected" : ""}>Member</option>
                <option ${user.role === "Admin" ? "selected" : ""}>Admin</option>
              </select>
            ` : ""}
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function userOptions() {
  return state.users.map((user) => `<option value="${user.id}" ${user.id === state.user.id ? "selected" : ""}>${escapeHtml(user.name)} (${user.role})</option>`).join("");
}

function assigneeOptions(projectId) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const memberIds = project ? project.memberIds : [];
  return state.users
    .filter((user) => memberIds.includes(user.id))
    .map((user) => `<option value="${user.id}" ${user.id === state.user.id ? "selected" : ""}>${escapeHtml(user.name)} (${user.role})</option>`)
    .join("");
}

function projectOptions() {
  return state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("");
}

function statusOptions() {
  return Object.entries(statusLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
}

function filterStatusOptions() {
  return [
    `<option value="all" ${state.taskFilters.status === "all" ? "selected" : ""}>All statuses</option>`,
    ...Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${state.taskFilters.status === value ? "selected" : ""}>${label}</option>`)
  ].join("");
}

function filterProjectOptions() {
  return [
    `<option value="all" ${state.taskFilters.projectId === "all" ? "selected" : ""}>All projects</option>`,
    ...state.projects.map((project) => `<option value="${project.id}" ${state.taskFilters.projectId === project.id ? "selected" : ""}>${escapeHtml(project.name)}</option>`)
  ].join("");
}

function canManage(project) {
  return state.user.role === "Admin" || project.ownerId === state.user.id;
}

function bindViewHandlers() {
  const projectForm = document.querySelector("#projectForm");
  if (projectForm) {
    projectForm.onsubmit = async (event) => {
      event.preventDefault();
      const data = formData(event.target);
      data.memberIds = Array.from(event.target.memberIds.selectedOptions).map((option) => option.value);
      await mutate("/api/projects", "POST", data);
    };
  }
  const taskForm = document.querySelector("#taskForm");
  if (taskForm) {
    const projectSelect = document.querySelector("#projectSelect");
    const assigneeSelect = document.querySelector("#assigneeSelect");
    if (projectSelect && assigneeSelect) {
      projectSelect.onchange = () => {
        assigneeSelect.innerHTML = assigneeOptions(projectSelect.value);
      };
    }
    taskForm.onsubmit = async (event) => {
      event.preventDefault();
      await mutate("/api/tasks", "POST", formData(event.target));
    };
  }
  const taskSearch = document.querySelector("#taskSearch");
  if (taskSearch) {
    taskSearch.oninput = () => {
      state.taskFilters.query = taskSearch.value;
      renderApp();
    };
  }
  const taskStatusFilter = document.querySelector("#taskStatusFilter");
  if (taskStatusFilter) {
    taskStatusFilter.onchange = () => {
      state.taskFilters.status = taskStatusFilter.value;
      renderApp();
    };
  }
  const taskProjectFilter = document.querySelector("#taskProjectFilter");
  if (taskProjectFilter) {
    taskProjectFilter.onchange = () => {
      state.taskFilters.projectId = taskProjectFilter.value;
      renderApp();
    };
  }
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.onclick = () => mutate(`/api/tasks/${button.dataset.task}`, "PATCH", { status: button.dataset.status });
  });
  document.querySelectorAll("[data-delete-task]").forEach((button) => {
    button.onclick = () => mutate(`/api/tasks/${button.dataset.deleteTask}`, "DELETE");
  });
  document.querySelectorAll("[data-delete-project]").forEach((button) => {
    button.onclick = () => mutate(`/api/projects/${button.dataset.deleteProject}`, "DELETE");
  });
  document.querySelectorAll("[data-role-user]").forEach((select) => {
    select.onchange = () => mutate(`/api/users/${select.dataset.roleUser}/role`, "PATCH", { role: select.value });
  });
}

async function mutate(path, method, body) {
  try {
    await api(path, { method, body: body ? JSON.stringify(body) : undefined });
    setMessage("Saved.", "ok");
    await refresh();
  } catch (error) {
    setMessage(error.message);
  }
  renderApp();
}

function logout() {
  localStorage.removeItem("ttm_token");
  state.token = "";
  state.user = null;
  setMessage("");
  renderAuth();
}

boot();
