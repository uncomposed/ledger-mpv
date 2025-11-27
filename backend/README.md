# Backend Starter

This folder holds the Node/TypeScript + Prisma backend for the weekly meal-planning app.

## Setup
1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Install dependencies (add to `package.json` as you scaffold the API).
3. Run `npx prisma migrate dev --name init` to create the schema locally.
4. Generate the Prisma client: `npx prisma generate`.
5. Start your HTTP server (Express/Nest/tRPC) and wire routes to services that use the Prisma client.

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
