# Ledger Web (Next.js App Router)

Minimal frontend for the meal-planning MVP with Clerk auth, tasks list, queue, entity summary, and AI key input (client-side only).

## Setup
1) `cp .env.local.example .env.local`
2) Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_API_BASE` (e.g., `http://localhost:4000`).
3) `npm install`
4) `npm run dev`

Backend requirements: API running (`npm run dev` in `../backend`) with Clerk configured or using dev headers.

## Notes
- Auth: App Router + `ClerkProvider` + `proxy.ts` with `clerkMiddleware`.
- Entity ID: Paste the Entity ID (e.g., from `/seed/demo`) into the field on the home page to load tasks/queue/summary.
- AI key: Stored in `localStorage`; sent only when you wire analyst-triggering calls.
