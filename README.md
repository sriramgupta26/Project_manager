# Team Task Manager

A full-stack web app for creating projects, assigning tasks, tracking status, and managing team access with Admin/Member roles.

## Features

- Signup and login with password hashing
- First registered user becomes `Admin`; later users become `Member`
- REST APIs for auth, users, projects, tasks, and dashboard metrics
- Role-based access control:
  - Admins can manage all projects, users, roles, and tasks
  - Members can access projects they belong to
  - Project owners can manage their own projects
- Project membership relationships
- Task assignment to project members only
- Status tracking: `todo`, `in_progress`, `review`, `done`
- Dashboard totals, status counts, overdue tasks, and personal open tasks
- Search and filter tasks by text, status, and project
- Health check endpoint for deployment monitoring
- Persistent NoSQL-style JSON database

## Tech Stack

- Node.js HTTP server
- Vanilla JavaScript frontend
- JSON document database stored at `data/db.json`
- No external npm dependencies

## Local Setup

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Optional health check:

```bash
npm run health
```

## Railway Deployment

1. Create a new GitHub repository.
2. Push this project to that repository.
3. Create a new Railway project.
4. Select **Deploy from GitHub repo** and choose your new repository.
5. Add these environment variables in Railway:

```bash
JWT_SECRET=use-a-long-random-production-secret
DB_FILE=/data/db.json
```

6. If you want data to survive redeploys, add a Railway volume mounted at `/data`.
7. Railway will run:

```bash
npm start
```

The app listens on `process.env.PORT`, which Railway provides automatically.

Health check URL after deploy:

```bash
https://your-railway-domain.up.railway.app/api/health
```

## API Overview

### Auth

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`

### Users

- `GET /api/users`
- `PATCH /api/users/:id/role`

### Projects

- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`

### Tasks

- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`

### Dashboard

- `GET /api/dashboard`

### Health

- `GET /api/health`

## Submission

- Live URL: add your Railway URL here after deployment
- GitHub repo: add your repository URL here
