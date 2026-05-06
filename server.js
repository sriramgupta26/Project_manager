const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-production";
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const STATUS_VALUES = ["todo", "in_progress", "review", "done"];
const ROLE_VALUES = ["Admin", "Member"];
const APP_VERSION = "1.1.0";

function ensureDatabase() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    writeDb({ users: [], projects: [], tasks: [], sessions: [] });
  }
}

function readDb() {
  ensureDatabase();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = stored.split(":");
  const testHash = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(testHash, "hex"));
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function signToken(payload) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const body = base64url({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) return null;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return payload.exp > Date.now() ? payload : null;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function getToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
  });
}

function send(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function fail(res, status, message, details) {
  send(res, status, { error: message, details });
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function requireAuth(req, res, db) {
  const payload = verifyToken(getToken(req));
  const user = payload && db.users.find((candidate) => candidate.id === payload.sub);
  if (!user) {
    fail(res, 401, "Authentication required.");
    return null;
  }
  return user;
}

function isAdmin(user) {
  return user.role === "Admin";
}

function canAccessProject(user, project) {
  return isAdmin(user) || project.memberIds.includes(user.id);
}

function canManageProject(user, project) {
  return isAdmin(user) || project.ownerId === user.id;
}

function projectMembersExist(db, memberIds) {
  return memberIds.every((memberId) => db.users.some((user) => user.id === memberId));
}

function normalizeMemberIds(memberIds, ownerId) {
  return Array.from(new Set([ownerId, ...(Array.isArray(memberIds) ? memberIds : [])]));
}

function routeKey(req, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  return { parts, method: req.method };
}

function serializeTask(task, db) {
  const assignee = db.users.find((user) => user.id === task.assigneeId);
  const project = db.projects.find((item) => item.id === task.projectId);
  return {
    ...task,
    assigneeName: assignee ? assignee.name : "Unassigned",
    projectName: project ? project.name : "Deleted project"
  };
}

async function handleApi(req, res, url) {
  const db = readDb();
  const { parts, method } = routeKey(req, url);

  try {
    if (method === "GET" && parts.join("/") === "api/health") {
      return send(res, 200, {
        ok: true,
        app: "team-task-manager",
        version: APP_VERSION,
        uptime: Math.round(process.uptime()),
        checkedAt: new Date().toISOString()
      });
    }

    if (method === "POST" && parts.join("/") === "api/auth/signup") {
      const body = await parseBody(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (name.length < 2) return fail(res, 400, "Name must be at least 2 characters.");
      if (!validateEmail(email)) return fail(res, 400, "A valid email is required.");
      if (password.length < 8) return fail(res, 400, "Password must be at least 8 characters.");
      if (db.users.some((user) => user.email === email)) return fail(res, 409, "Email is already registered.");

      const user = {
        id: id("usr"),
        name,
        email,
        role: db.users.length === 0 ? "Admin" : "Member",
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      writeDb(db);
      const token = signToken({ sub: user.id, role: user.role });
      return send(res, 201, { user: sanitizeUser(user), token });
    }

    if (method === "POST" && parts.join("/") === "api/auth/login") {
      const body = await parseBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = db.users.find((candidate) => candidate.email === email);
      if (!user || !verifyPassword(password, user.passwordHash)) return fail(res, 401, "Invalid email or password.");
      const token = signToken({ sub: user.id, role: user.role });
      return send(res, 200, { user: sanitizeUser(user), token });
    }

    if (method === "GET" && parts.join("/") === "api/me") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      return send(res, 200, { user: sanitizeUser(user) });
    }

    if (method === "GET" && parts.join("/") === "api/users") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      return send(res, 200, { users: db.users.map(sanitizeUser) });
    }

    if (method === "PATCH" && parts[0] === "api" && parts[1] === "users" && parts[3] === "role") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      if (!isAdmin(user)) return fail(res, 403, "Only admins can change roles.");
      const target = db.users.find((candidate) => candidate.id === parts[2]);
      if (!target) return fail(res, 404, "User not found.");
      const body = await parseBody(req);
      if (!ROLE_VALUES.includes(body.role)) return fail(res, 400, "Role must be Admin or Member.");
      target.role = body.role;
      writeDb(db);
      return send(res, 200, { user: sanitizeUser(target) });
    }

    if (method === "GET" && parts.join("/") === "api/projects") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const projects = db.projects
        .filter((project) => canAccessProject(user, project))
        .map((project) => ({
          ...project,
          taskCount: db.tasks.filter((task) => task.projectId === project.id).length,
          completedTaskCount: db.tasks.filter((task) => task.projectId === project.id && task.status === "done").length
        }));
      return send(res, 200, { projects });
    }

    if (method === "POST" && parts.join("/") === "api/projects") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const body = await parseBody(req);
      const name = String(body.name || "").trim();
      const description = String(body.description || "").trim();
      const memberIds = normalizeMemberIds(body.memberIds, user.id);
      if (name.length < 3) return fail(res, 400, "Project name must be at least 3 characters.");
      if (!projectMembersExist(db, memberIds)) return fail(res, 400, "Every project member must be an existing user.");
      const project = {
        id: id("prj"),
        name,
        description,
        ownerId: user.id,
        memberIds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.projects.push(project);
      writeDb(db);
      return send(res, 201, { project });
    }

    if ((method === "PATCH" || method === "DELETE") && parts[0] === "api" && parts[1] === "projects") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const project = db.projects.find((candidate) => candidate.id === parts[2]);
      if (!project) return fail(res, 404, "Project not found.");
      if (!canManageProject(user, project)) return fail(res, 403, "Only admins and project owners can manage this project.");

      if (method === "DELETE") {
        const projectId = project.id;
        const nextDb = {
          ...db,
          projects: db.projects.filter((candidate) => candidate.id !== projectId),
          tasks: db.tasks.filter((task) => task.projectId !== projectId)
        };
        writeDb(nextDb);
        return send(res, 200, { ok: true });
      }

      const body = await parseBody(req);
      const name = body.name === undefined ? project.name : String(body.name || "").trim();
      const description = body.description === undefined ? project.description : String(body.description || "").trim();
      const memberIds = body.memberIds === undefined ? project.memberIds : normalizeMemberIds(body.memberIds, project.ownerId);
      if (name.length < 3) return fail(res, 400, "Project name must be at least 3 characters.");
      if (!projectMembersExist(db, memberIds)) return fail(res, 400, "Every project member must be an existing user.");
      Object.assign(project, { name, description, memberIds, updatedAt: new Date().toISOString() });
      db.tasks.forEach((task) => {
        if (task.projectId === project.id && !project.memberIds.includes(task.assigneeId)) task.assigneeId = project.ownerId;
      });
      writeDb(db);
      return send(res, 200, { project });
    }

    if (method === "GET" && parts.join("/") === "api/tasks") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const visibleProjectIds = db.projects.filter((project) => canAccessProject(user, project)).map((project) => project.id);
      let tasks = db.tasks.filter((task) => visibleProjectIds.includes(task.projectId));
      if (url.searchParams.get("projectId")) tasks = tasks.filter((task) => task.projectId === url.searchParams.get("projectId"));
      if (url.searchParams.get("status")) tasks = tasks.filter((task) => task.status === url.searchParams.get("status"));
      if (url.searchParams.get("assigneeId")) tasks = tasks.filter((task) => task.assigneeId === url.searchParams.get("assigneeId"));
      return send(res, 200, { tasks: tasks.map((task) => serializeTask(task, db)) });
    }

    if (method === "POST" && parts.join("/") === "api/tasks") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const body = await parseBody(req);
      const project = db.projects.find((candidate) => candidate.id === body.projectId);
      if (!project) return fail(res, 404, "Project not found.");
      if (!canAccessProject(user, project)) return fail(res, 403, "You are not a member of this project.");
      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      const status = STATUS_VALUES.includes(body.status) ? body.status : "todo";
      const assigneeId = body.assigneeId || user.id;
      const dueDate = body.dueDate ? String(body.dueDate) : "";
      if (title.length < 3) return fail(res, 400, "Task title must be at least 3 characters.");
      if (!project.memberIds.includes(assigneeId)) return fail(res, 400, "Assignee must be a project member.");
      const task = {
        id: id("tsk"),
        projectId: project.id,
        title,
        description,
        status,
        assigneeId,
        creatorId: user.id,
        dueDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.tasks.push(task);
      writeDb(db);
      return send(res, 201, { task: serializeTask(task, db) });
    }

    if ((method === "PATCH" || method === "DELETE") && parts[0] === "api" && parts[1] === "tasks") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const task = db.tasks.find((candidate) => candidate.id === parts[2]);
      if (!task) return fail(res, 404, "Task not found.");
      const project = db.projects.find((candidate) => candidate.id === task.projectId);
      if (!project || !canAccessProject(user, project)) return fail(res, 403, "You cannot access this task.");
      const manager = canManageProject(user, project);
      if (method === "DELETE") {
        if (!manager && task.creatorId !== user.id) return fail(res, 403, "Only admins, project owners, and task creators can delete tasks.");
        db.tasks = db.tasks.filter((candidate) => candidate.id !== task.id);
        writeDb(db);
        return send(res, 200, { ok: true });
      }

      const body = await parseBody(req);
      const mayEditAllFields = manager || task.creatorId === user.id;
      if (body.status !== undefined) {
        if (!STATUS_VALUES.includes(body.status)) return fail(res, 400, "Invalid task status.");
        if (!mayEditAllFields && task.assigneeId !== user.id) return fail(res, 403, "Only the assignee can update task status.");
        task.status = body.status;
      }
      if (mayEditAllFields) {
        if (body.title !== undefined) {
          const title = String(body.title || "").trim();
          if (title.length < 3) return fail(res, 400, "Task title must be at least 3 characters.");
          task.title = title;
        }
        if (body.description !== undefined) task.description = String(body.description || "").trim();
        if (body.assigneeId !== undefined) {
          if (!project.memberIds.includes(body.assigneeId)) return fail(res, 400, "Assignee must be a project member.");
          task.assigneeId = body.assigneeId;
        }
        if (body.dueDate !== undefined) task.dueDate = body.dueDate ? String(body.dueDate) : "";
      }
      task.updatedAt = new Date().toISOString();
      writeDb(db);
      return send(res, 200, { task: serializeTask(task, db) });
    }

    if (method === "GET" && parts.join("/") === "api/dashboard") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const today = new Date().toISOString().slice(0, 10);
      const visibleProjectIds = db.projects.filter((project) => canAccessProject(user, project)).map((project) => project.id);
      const tasks = db.tasks.filter((task) => visibleProjectIds.includes(task.projectId));
      const mine = tasks.filter((task) => task.assigneeId === user.id);
      const byStatus = STATUS_VALUES.reduce((acc, status) => ({ ...acc, [status]: tasks.filter((task) => task.status === status).length }), {});
      const overdue = tasks.filter((task) => task.dueDate && task.dueDate < today && task.status !== "done");
      return send(res, 200, {
        totals: {
          projects: visibleProjectIds.length,
          tasks: tasks.length,
          myTasks: mine.length,
          overdue: overdue.length,
          completed: tasks.filter((task) => task.status === "done").length
        },
        byStatus,
        overdueTasks: overdue.map((task) => serializeTask(task, db)).slice(0, 8),
        myOpenTasks: mine.filter((task) => task.status !== "done").map((task) => serializeTask(task, db)).slice(0, 8)
      });
    }

    return fail(res, 404, "API route not found.");
  } catch (error) {
    return fail(res, 400, error.message || "Bad request.");
  }
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  const finalPath = fs.existsSync(filePath) ? filePath : path.join(PUBLIC_DIR, "index.html");
  const ext = path.extname(finalPath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(finalPath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

ensureDatabase();
server.listen(PORT, () => {
  if (JWT_SECRET === "change-this-secret-before-production") {
    console.warn("JWT_SECRET is using the development fallback. Set a strong JWT_SECRET before production deployment.");
  }
  console.log(`Team Task Manager running on http://localhost:${PORT}`);
});
