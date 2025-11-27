# Backend Starter

This folder holds the Node/TypeScript + Prisma backend for the weekly meal-planning app.

## Setup
1. Copy `.env.example` to `.env` and set `DATABASE_URL`. Default points to the Docker Compose Postgres service.
2. `npm install`
3. Ensure Postgres is running (`docker compose -f ../infra/docker-compose.yml up -d` from repo root).
4. Create the schema: `npm run prisma:migrate` (first run will create the initial migration) then `npm run prisma:generate`.
5. Start the API: `npm run dev` (or `npm run start` after `npm run build`).

## Services to implement
- **Auth**: Clerk (code-first config) or equivalent JWT middleware; issue entity-scoped session context.
- **Entities & membership**: CRUD with role enforcement.
- **Tracks & lenses**: Upload track metadata, trigger `LensRun` jobs; accept AI API key per request for analyst execution.
- **Change review**: Approve or reject `ChangeSet` payloads via question/answer tasks.
- **Planning & tasks**: Weekly recurrence job, task assignment, status transitions, and audit logging.

## Background jobs
Use BullMQ or cron-triggered workers for:
- Weekly creation of `Goal` + `Task(PLAN_WEEKLY_MEALS)`.
- Processing `LensRun` records → analyst call → `ChangeSet` creation → question tasks.
- Applying approved `ChangeSets` to live tables.

## Observability
- Add structured logging, OTEL traces, and Prisma query logging.
- Expose health endpoints and job/queue metrics; avoid logging secrets such as the per-request AI key.

## Available routes in this MVP stub
- `GET /health` — service heartbeat.
- `POST /actors` — create an actor `{ email, name? }`.
- `POST /entities` — create an entity `{ name, adminActorId? }`; seeds base locations/sensors.
- `POST /entities/:entityId/actors` — add membership `{ actorId, role }`.
- `POST /entities/:entityId/resources` — add a resource.
- `POST /entities/:entityId/inventory` — add/update inventory item.
- `POST /entities/:entityId/goals/weekly-plan` — create or reuse a weekly plan goal + planning task.
- `POST /entities/:entityId/tracks` — create a track + pending lens run (defaults to inventory lens).
- `GET /entities/:entityId/tasks?actorId=&type=` — list tasks with optional filters.
- `POST /tasks/:taskId/status` — update task status.
- `POST /seed/demo` — seed a demo household, admin actor, inventory, and weekly planning task.
- `GET /entities/:entityId/summary` — lightweight snapshot of tasks, inventory, and goals.

Replace the header-based context (`x-actor-id`, `x-entity-id`) with Clerk-authenticated context when you wire auth.
