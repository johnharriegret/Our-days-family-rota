# Our Days — Family Rota & Calendar Optimiser

A mobile-first family calendar and shift-planning app: a configurable repeating
work-pattern engine (for a 4-on/4-off style rota), manual shift entry with a
hard per-week hours requirement, school terms, and a childcare-coverage rule
— not just a calendar.

This is the Phase 1 build. See `docs/ARCHITECTURE.md` for the full target
design (the later phases: Mum's shift optimiser, the annual-leave/holiday
finder, the Jarvis-facing REST + MCP API, PWA/kiosk mode, notifications).

## Stack

Next.js 16 (App Router) + TypeScript + React 19, Postgres via Prisma
(Supabase-hosted), cookie-based sessions (`jose` + `scrypt`), no ORM-free raw
SQL, no NextAuth — kept deliberately simple per the project brief.

## Run locally

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `DATABASE_URL` / `DATABASE_URL_NON_POOLING` — a Postgres connection
     (Supabase project → Settings → Database gives you `POSTGRES_URL` and
     `POSTGRES_URL_NON_POOLING`, which map directly to these two).
   - `SESSION_SECRET` — `openssl rand -hex 32`
   - `SETUP_TOKEN` — `openssl rand -hex 24`, shown once to whoever creates
     the first admin account.
3. `npx prisma migrate deploy` (applies `prisma/migrations/0001_init`).
4. `npm run dev`, open `http://localhost:3000`. You'll land on `/setup` the
   first time — enter the setup token to create the household and the first
   admin login, then add the rest of the family and Dad's/Mum's schedules
   from Settings.

## Tests

`npm test` runs the scheduling-engine unit tests (`lib/engine/*` — pattern
generation, DST-crossing shift intervals, the hard weekly-hours rule, the
childcare 3-hour allowance, school-day lookup, days-off-together). These are
pure functions with no DB/UI dependency, per the project's own engineering
rule that calendar math must be deterministic and independently testable.

## Deploy

This repo is meant to be connected to the existing `gretresidencerota`
Vercel project (same Supabase Postgres instance that project already has
provisioned) — point that project's Git integration at this repo, add
`DATABASE_URL`/`DATABASE_URL_NON_POOLING` (its `POSTGRES_URL`/
`POSTGRES_URL_NON_POOLING` values), keep its existing `SESSION_SECRET`/
`SETUP_TOKEN`. `npm run vercel-build` runs `prisma migrate deploy` before
`next build`, so pushing to the connected branch applies any new migration
automatically.
