# Backend Starter

This folder holds the Node/TypeScript + Prisma backend for the weekly meal-planning app.

## Setup
1. Copy `.env.example` to `.env` and set `DATABASE_URL`. Default points to the Docker Compose Postgres service.
2. `npm install`
3. Ensure Postgres is running (`docker compose -f ../infra/docker-compose.yml up -d` from repo root).
4. Create the schema: `npm run prisma:migrate` (first run will create the initial migration) then `npm run prisma:generate`.
5. Start the API: `npm run dev` (or `npm run start` after `npm run build`).

## Auth (Clerk) – optional
- Add to `.env`: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_TEMPLATE` (template name from Clerk dashboard).
- Install the dependency: `npm install @clerk/express`.
- The server will use Clerk automatically when `CLERK_SECRET_KEY` is present; otherwise it falls back to header-based dev auth (`x-actor-id`, `x-entity-id`).
- On first authenticated request, the server upserts an `Actor` from the Clerk user (email + name).

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
- `GET /me` — returns `actorId`/`entityId` from auth context (requires auth).
- `POST /actors` — create an actor `{ email, name? }`.
- `POST /entities` — create an entity `{ name, adminActorId? }`; seeds base locations/sensors.
- `POST /entities/:entityId/actors` — add membership `{ actorId, role }`.
- `POST /entities/:entityId/resources` — add a resource.
- `POST /entities/:entityId/inventory` — add/update inventory item.
- `POST /entities/:entityId/goals/weekly-plan` — create or reuse a weekly plan goal + planning task.
- `POST /entities/:entityId/tracks` — create a track + pending lens run (defaults to inventory lens).
- `GET /entities/:entityId/tasks?actorId=&type=` — list tasks with optional filters.
- Filters now include `status` and `tag`.
- `POST /tasks/:taskId/status` — update task status.
- `POST /tasks/:taskId/tags` — replace tags array on a task.
- `POST /tasks/:taskId/assign` — assign an actor with role `{RESPONSIBLE|ACCOUNTABLE}`.
- `POST /tasks/:taskId/unassign` — remove an actor assignment.
- `GET /entities/:entityId/lens-runs` — list lens runs for an entity.
- `POST /lens-runs/:lensRunId/process` — stub analyst processor: turns a LensRun into a ChangeSet + Question and marks the run completed.
- `GET /entities/:entityId/questions` — list questions (requires membership).
- `POST /entities/:entityId/questions` — create a question (admins).
- `POST /questions/:questionId/answer` — answer a question `{ taskId, value }`.
- `GET /entities/:entityId/changesets` — list change sets.
- `POST /entities/:entityId/changesets` — create a change set (admins) (status defaults to `PENDING`).
- `POST /changesets/:changeSetId/approve` — mark change set `APPROVED` (admins).
- `POST /changesets/:changeSetId/apply` — apply a change set (admins; requires status `APPROVED`). Supports `INVENTORY_DIFF` (payload `items[]`) and `WEEKLY_MEAL_PLAN` (payload `tasks[]`).
- `POST /seed/demo` — seed a demo household, admin actor, inventory, and weekly planning task.
- `GET /entities/:entityId/summary` — lightweight snapshot of tasks, inventory, and goals.

Replace the header-based context (`x-actor-id`, `x-entity-id`) with Clerk-authenticated context when you wire auth.
