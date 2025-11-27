# Weekly Meal Planning MVP: Architecture & Evolution Plan

## Product Scope
- **Household-first**: One `Entity` per household; actors join via `EntityActor` with `ADMIN`/`MEMBER` roles.
- **Core flows**: pantry capture → inventory diff; weekly recurring planning job → plan review → task execution (buy/cook).
- **AI analyst**: Bring-your-own AI key supplied per request; no server storage. Used for lenses: `INVENTORY_LENS` and `MEAL_PLAN_LENS`.
- **Approval & minimal-invasive UI**: Batched `Questions` gated by `ChangeSet` payloads for inventory and weekly plans; one notification per actor per day.

## Architecture Overview
- **Backend stack**: Node/TypeScript with Express or Nest; Prisma ORM; Postgres DB. Background jobs via BullMQ or cron. File uploads via signed URLs (future).
- **API shape**: REST/JSON (mobile-friendly) with routes for auth, entities/actors, tracks, lenses, lens runs, changesets, questions/answers, tasks, inventory, and goals.
- **Authentication**: Integrate Clerk or similar via code-first adapters; tokens validated server-side; role/ACL enforcement via middleware. Environment toggles in code.
- **AI integration**: Analyst service module consumes `{trackId, lensType, aiApiKey}`; deterministic prompts/config stored in code; API key provided in request header/body; never persisted.
- **Observability**: Structured logging, OTEL traces, DB slow-query logs. Audit log table for all risky actions. Configurable log redaction to avoid leaking secrets.
- **Environment**: Docker Compose for local Postgres. Same schema/migration path for dev/stage/prod; secrets via env vars.

## Data Model (v1)
See `backend/prisma/schema.prisma` for concrete tables. Highlights:
- **Identity & membership**: `Actor`, `Entity`, `EntityActor` with role (`ADMIN`, `MEMBER`).
- **Locations**: `Location` tree per entity (home → pantry/fridge/freezer).
- **Inventory**: `Resource` and `InventoryItem` scoped to entity/location; optional expiry.
- **Goals & solutions**: `Goal` (type `WEEKLY_MEAL_PLAN`), `Solution` (recipes), `Step` with required resources via `StepResource` join.
- **Tasks**: Types cover planning, inventory review, buy resource, cook steps, apply changeset. Assignment via `TaskActor` with roles (`RESPONSIBLE`, `ACCOUNTABLE`).
- **Captures & analysis**: `Sensor`, `Track`, `Lens`, `LensRun` with analyst output blob.
- **Change review**: `ChangeSet` polymorphic on subject, `Question`/`Answer` tied to tasks, `Planning` link for weekly plan tasks, `AuditLog` append-only.

## Core Flows
1. **Household setup**: Admin creates entity, invites members; admins manage membership and approvals.
2. **Pantry capture → inventory update**:
   - Capture creates `Track` + `LensRun(INVENTORY_LENS)` → analyst proposes `ChangeSet(INVENTORY_DIFF)`.
   - System creates `Task(INVENTORY_REVIEW)` for admins with batched `Questions`; approval leads to `Task(APPLY_CHANGESET)` to persist inventory.
3. **Recurring weekly plan**:
   - Weekly job creates/activates `Goal` for the week and `Task(PLAN_WEEKLY_MEALS)` with `Planning` link.
   - Analyst reads inventory/preferences, proposes `ChangeSet(WEEKLY_MEAL_PLAN)` with recipes and generated tasks (`BUY_RESOURCE`, `COOK_RECIPE_STEP`).
   - Admins review via batched `Questions`; approval schedules tasks and assignments.
4. **Task execution**:
   - Task lists filter by responsibility or tags (to-buy, cooking). Swipes allow completion/blocking; blocking can spawn follow-up `Questions`.
   - Evidence capture (photos) stored as `Track`; optional verification later.

## Security, Audit, and Safety
- **Access control**: Middleware checks entity membership and role before CRUD. Task answering constrained to responsible/accountable actors; admins override per policy.
- **Auditability**: Every mutation writes to `AuditLog` with subject_type/id and actor; soft deletes on user-facing tables.
- **Prompt/SQL safety**: Analyst prompts include guardrails; user-provided AI keys scoped per request; sanitize analyst outputs before applying `ChangeSet` via approval tasks.

## Evolution Plan (post-v1)
- **Outsourcing vendors**: Add vendor actors and bidding workflow; extend task roles.
- **Schedule constraints**: Add temporal dependencies and blocking windows on tasks/steps.
- **Verification system**: Dedicated verification table/workflows for skill validation and evidence review.
- **Richer skills**: Skill tables and tagging for actors and steps; optional proficiency levels.
- **Integrations**: Calendar, Home Assistant, email forwarding; maintain code-defined adapters and config.
- **Analytics & monitoring**: Add event schema definitions and OTEL exporters; hook into CI for migration safety checks.

## AI Key UX Guidance
- Place "AI API key" input in the menu/account area (web and mobile).
- Store client-side only; send with analyst job requests when the user triggers planning or capture analysis.
- Backend validates presence per request and passes it to the analyst service; avoid logging the key.
