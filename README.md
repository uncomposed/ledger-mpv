# Ledger MVP

Bootstrap for a weekly meal-planning household app with clear domain model, backend stack guidance, and environment scaffolding.

## Contents
- `docs/architecture.md`: MVP scope, flows, data model, and evolution plan.
- `backend/`: Backend starter with Prisma schema, env example, and setup notes.
- `infra/`: Docker Compose for local Postgres.

## Quickstart
1. `cp backend/.env.example backend/.env` and set `DATABASE_URL`.
2. `docker compose -f infra/docker-compose.yml up -d` to start Postgres.
3. From `backend/`, run `npm install` (after adding dependencies) and `npx prisma migrate dev` to create the schema.
4. Start the API service of your choice (Express/Nest/tRPC) wired to the Prisma client.

## AI Key Handling
Clients should prompt for a user-provided AI API key in the menu/profile area and send it to the backend only when running analyst jobs. Keys are not stored server-side in this MVP; they are supplied per-request.
