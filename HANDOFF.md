# Our Days — Handoff / Takeover Brief

Last updated: 2026-09-27 (day of first deploy). Read this fully before making
changes — it's the "pick this project up from zero" document, same idea as
the sibling `siteroster` project's own `HANDOFF.md`.

---

## 0. What this is

A family calendar + rota-planning app for one household: a configurable
repeating shift-pattern engine (Dad's 4-on/4-off style rota), Mum's manual
shifts against a hard per-week hours requirement, school terms, events, and
a childcare-coverage rule — built to eventually answer "when are we actually
free together?" via a Jarvis-facing API. Full spec and target architecture
are in `docs/ARCHITECTURE.md`; remaining phased work is in `TODO.md`.

This is **Phase 1** of a 5-phase build (see `TODO.md` §Phase 2-5). Phase 1 —
auth, family members, Dad's rota, Mum's shifts, schools/terms, events,
Today/Week/Month calendar, days-off-together — is built, tested, and live.

---

## 1. Access map

| System | Detail |
|---|---|
| Live site | `https://gretresidencerota.vercel.app` |
| GitHub | `https://github.com/johnharriegret/our-days-family-rota` — **private**, branch `main`, owner `johnharriegret` |
| Vercel | Project **"gretresidencerota"**, team **"JCZ Compliance"** (`jcz-compliance`, team id `team_kB0f1hwImHFRKmuNLMZ5vmEn`). Auto-deploys on push to `main` (Git integration connected 2026-09-27 — see §9 gotcha #1 for how that connection was made). |
| Supabase | Postgres connected via the Vercel Supabase integration on the `gretresidencerota` project (env vars `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` / `SUPABASE_URL` etc. — see the project's Vercel integration settings for the actual Supabase dashboard link; not recorded here since this session never had a reason to open it directly). |
| Admin/setup | First-run `/setup` page, gated by the `SETUP_TOKEN` env var. **Current value was reset during this session** (the original was unrecoverable — see §9 gotcha #2) to `a5d4dd84ed7715e235d6717b37cc542be4f2ecce65b9ff0a`. Once the first admin account is created, `/setup` locks itself (409s) and this token stops mattering — the founder should still treat it as spent/rotate it as a habit rather than assume it's still meaningful. |
| Session secret | `SESSION_SECRET` — already set on Vercel, never read back this session (same write-only reasoning as the setup token). |

## 2. What preceded this repo

`gretresidencerota.vercel.app` was previously a **rough prototype**
("Our Days"), deployed as a one-off `vercel deploy` file upload with **no
Git history anywhere** — not this repo, not any repo. It used the same
Vercel project and the same Supabase Postgres instance this repo now uses,
but its own code (`DATABASE_URL`-based, hand-rolled table bootstrap) was
never version-controlled and was actually broken in production (see §9
gotcha #3). That prototype's design ideas (block-based shift pattern,
minute-offset overnight-shift handling) carried over conceptually into this
repo's `lib/engine/pattern.ts` / `intervals.ts`, but none of its literal code
was reusable, so this repo is a clean rebuild, not a port.

## 3. Tech stack & architecture

- **Next.js 16** (App Router, TypeScript), **React 19**.
- **Prisma + Postgres** (Supabase-hosted). Schema at `prisma/schema.prisma`,
  one migration so far (`prisma/migrations/0001_init`). `npm run vercel-build`
  runs `prisma migrate deploy` before `next build`, so every push applies any
  new migration automatically — there is no manual migration step on deploy.
- **Auth**: `scrypt` password hashes (`src/lib/auth.ts`) + a signed HTTP-only
  JWT session cookie (`src/lib/jwt.ts`, using `jose`) with `ADMIN`/`PARENT`/
  `CHILD` roles. Deliberately no NextAuth/OAuth — see `docs/ARCHITECTURE.md`
  §1 for why.
- **`src/proxy.ts`** (not `middleware.ts` — Next 16 renamed the convention;
  see §9 gotcha #4) gates every non-public route, redirecting to `/login` if
  there's no valid session cookie. Real authorization still happens per-route
  in the API handlers (`requireSession`/`requireRole` in `src/lib/session.ts`)
  — the proxy redirect is just a UX-level optimistic check, per Next's own
  guidance that Proxy "should not be used as a full session management or
  authorization solution."
- **`src/lib/engine/*`** — the scheduling math. Pure functions, zero DB/UI
  imports, fully unit-tested (`npm test`, 27 tests, `node:test`): repeating
  pattern resolution (`pattern.ts`), DST-safe local-time→UTC conversion
  (`intervals.ts`), the hard per-week-hours rule (`weeklyHours.ts`), the
  childcare 3-hour allowance (`childcare.ts`), school-day lookup
  (`school.ts`), days-off-together (`daysOffTogether.ts`), a static UK
  bank-holiday table (`bankHolidays.ts` — hand-maintained, update yearly from
  gov.uk).
- **`src/lib/calendarService.ts`** — the one place that merges a parent's
  active pattern version + any manual `WorkShift` override + a child's
  school status into a single per-day view (`getCalendarRange`). Pattern
  versions are matched to dates by `effectiveFrom`, not just "whichever is
  newest" — editing Dad's rota today does not retroactively change what last
  month's calendar showed (see the code comment there for why this matters).
- Plain CSS (`src/app/globals.css`), no component library — deliberate, per
  the founder's "don't over-engineer the UI" instruction.

## 4. Current live state (as of first deploy, 2026-09-27)

- Phase 1 fully deployed and building/passing tests/lint at time of deploy.
- **No family data exists yet** — the database has zero rows until someone
  completes `/setup`. First real use will be: create the admin account, then
  from Settings add the rest of the family, Dad's rota (blocks + anchor
  date), Mum's one-tap shift types, school(s) + term dates, and the
  childcare rule (defaults to a 3-hour allowance, weekends + 13+ home).
- The childcare engine (`lib/engine/childcare.ts`) is built and tested but
  **not yet wired into any UI** — no conflict banners exist yet. That's
  Phase 2 (see `TODO.md`).

## 5. Genuinely open items / TODO

See `TODO.md` in the repo for the full Phase 2-5 breakdown (Mum's shift
optimiser, the annual-leave/holiday-bridging finder, the Jarvis REST + MCP
API, API keys, PWA/kiosk mode, notifications, ICS/backup export). Nothing in
Phase 1 was deliberately left half-built; what's listed there is genuinely
not started yet, not a partial implementation.

## 6. Technical gotchas (read before touching Vercel/deploy config)

1. **Linking a Vercel project to a new GitHub repo can't be done via the
   Vercel API/MCP tools** if the project already exists unlinked (a
   deliberate Vercel safeguard against silently hijacking an existing
   project — the API 409s). It has to be done once through the Vercel
   dashboard: **Settings → Git → Connect Git Repository**. Separately, the
   **Vercel GitHub App** (`github.com/apps/vercel`) has to actually be
   installed with access to the target repo — it's a different app from
   whatever GitHub App an AI coding session uses, and Vercel's own link
   attempt fails with a clear "install the GitHub App first" error if it
   isn't. Both of those were one-time manual steps for this repo; they
   shouldn't need repeating.
2. **Vercel's "sensitive" env var type is write-only.** `SETUP_TOKEN` and
   `SESSION_SECRET` are stored that way — once set, **nobody can read the
   value back**, not via the API, not via the dashboard, not the account
   owner. If a token is ever "lost," the only fix is to generate a new one
   and overwrite it (safe for `SETUP_TOKEN` specifically, since it only
   gates the one-time first-admin bootstrap and `/setup` refuses to run
   again once a household exists). **Overwriting an env var only affects
   deployments created after the change** — an in-flight or already-built
   deployment keeps whatever value it started with, so a token rotation
   needs a fresh deployment to actually take effect.
3. **The env var name matters and has bitten this project before**: Prisma
   here reads `POSTGRES_URL`/`POSTGRES_URL_NON_POOLING` (the names the
   Supabase Vercel integration actually creates), not `DATABASE_URL`. The
   original one-off prototype used `DATABASE_URL` and was silently broken in
   production for exactly this reason — don't reintroduce that mismatch.
4. **Next.js 16 renamed Middleware to Proxy.** The file is `src/proxy.ts`
   exporting a `proxy` function, not `middleware.ts`/`middleware`. This
   version's `next build` will warn (not error) if you go back to the old
   convention — heed the warning if you see it again, don't ignore it.
   `node:crypto`-using code (password hashing) must never be imported into
   that file's module graph, even transitively — it runs on the Edge
   runtime, which doesn't support Node's `crypto` module. That's why
   `src/lib/jwt.ts` (session sign/verify, `jose`-only) is split out from
   `src/lib/auth.ts` (password hashing, `node:crypto`) — the proxy imports
   only the former.
5. **`eslint-config-next` for this Next.js version uses native ESLint flat
   config exports** (`eslint-config-next/core-web-vitals`,
   `eslint-config-next/typescript`) — not the old `FlatCompat` +
   `next/core-web-vitals` string-extends pattern from earlier Next
   generations, which actually crashes (`Converting circular structure to
   JSON`) against this version's peer deps. See `eslint.config.mjs`.
6. **`react-hooks/set-state-in-effect`** (part of `eslint-plugin-react-hooks`
   v6's React-Compiler-era recommended rules, now pulled in by
   `eslint-config-next`) flags the standard "fetch on mount in a client
   component" pattern used throughout `src/app/(app)/*`. This project
   doesn't opt into the React Compiler, so that rule is turned off in
   `eslint.config.mjs` with a comment explaining why — it's not a
   suppressed real bug, just a compiler-oriented heuristic that doesn't
   apply here.
7. **This Next.js version may differ from your training data in other ways
   too** — `AGENTS.md`/`CLAUDE.md` at the repo root point at
   `node_modules/next/dist/docs/` and say to check it before assuming
   anything about App Router conventions. Worth re-reading that note if a
   future session hits an unexpected Next.js error.

## 7. How this session worked (context for whoever picks this up)

- The founder's original ask was a very detailed 25-section brief (family
  members, school calendar, childcare rule engine, Mum's shift optimiser,
  annual-leave optimiser, days-off-together, ultra-simple data entry,
  "what-if" planner, a Jarvis-facing API + MCP server, auth roles, Postgres
  via Prisma, PWA/kiosk mode, notifications, export/backup, explicit UX
  principles, and an explicit phased build order) — that brief is preserved
  verbatim in spirit across `docs/ARCHITECTURE.md` and `TODO.md`.
- Per the brief's own instruction ("Do NOT begin the full implementation
  until the architecture is coherent. Then show me the plan."), the session
  proposed the full target architecture first via Claude Code's plan-mode
  flow, got explicit sign-off (including on four specific judgement calls:
  Monday-start weeks, nominal-not-elapsed DST pay, the 13-year-old counting
  as a supervisor any time they're not himself at school, and a static
  hand-maintained bank-holiday table over an external API), and only then
  built Phase 1.
- The founder explicitly asked for this to be a **separate repo from
  `siteroster`** (an unrelated pre-existing project in the same GitHub
  account) — the two must never be conflated or cross-contaminated.

## 8. First steps for whoever picks this up

1. `git clone` this repo, `git log -5 --oneline` to see what's actually
   committed.
2. Read `docs/ARCHITECTURE.md` in full, then `TODO.md` for what's left.
3. Confirm what's actually live: check the Vercel project's latest
   deployment matches the repo's `main` HEAD before assuming they match.
4. Do not attempt to read back `SETUP_TOKEN` or `SESSION_SECRET` — per §6.2,
   it's not possible, and it's not necessary once the household exists.
5. Never touch `siteroster` from a session working on this repo, or vice
   versa — they're deliberately separate, unrelated projects that happen to
   share a GitHub owner and a Vercel team.
