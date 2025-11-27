# Ledger MVP

Bootstrap for a weekly meal-planning household app with clear domain model, backend stack guidance, and environment scaffolding.

## Contents
- `docs/architecture.md`: MVP scope, flows, data model, and evolution plan.
- `backend/`: Backend starter with Prisma schema, env example, and setup notes.
- `web/`: Next.js App Router frontend (Clerk auth) with tasks/queue/entity views and AI key input.
- `infra/`: Docker Compose for local Postgres.

## Quickstart
1. `cp backend/.env.example backend/.env` and set `DATABASE_URL`.
2. `docker compose -f infra/docker-compose.yml up -d` to start Postgres.
3. From `backend/`, run `npm install`, then `npm run prisma:migrate` and `npm run prisma:generate` to create the schema and client.
4. Start the API stub: `npm run dev` (Express + Prisma). A demo dataset can be bootstrapped via `curl -X POST <URL>/seed/demo`.
5. Frontend (optional): From `web/`, `cp .env.local.example .env.local`, set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_API_BASE`, then `npm install` and `npm run dev`.

## AI Key Handling
Clients should prompt for a user-provided AI API key in the menu/profile area and send it to the backend only when running analyst jobs. Keys are not stored server-side in this MVP; they are supplied per-request.
