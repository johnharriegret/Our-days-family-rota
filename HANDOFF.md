# Our Days — Handoff / Takeover Brief

Last updated: 2026-09-28, 10:10 BST (Session 7). Read this fully before making
changes - it's the "pick this project up from zero" document, same idea as the
sibling `siteroster` project's own `HANDOFF.md`. **Read §11 first if you're
picking this up fresh**, then §10: between them they cover a whole-scheduler
rebuild and 17 commits that §0-§9 predate. §9 is a historical record of Session
2 and is now wrong in places - §11 says exactly where.

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
| Anthropic API key | `ANTHROPIC_API_KEY` — **not set as of end of Session 2**. Powers the photo/PDF school-calendar importer (§9.4); everything else works without it. The founder said in Session 2 they'd "found a way to organize it" themselves — don't chase adding it unless asked. Optional `ANTHROPIC_MODEL` env var overrides the model (defaults to `claude-sonnet-5` in `src/lib/schoolVisionImport.ts`). |

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
  four migrations so far (`0001_init` plus three additive Session 2 ones:
  per-term weekdays, quick-fill day/night colour defaults, strict pickup
  age). `npm run vercel-build` runs `prisma migrate deploy` before
  `next build`, so every push applies any new migration automatically —
  there is no manual migration step on deploy.
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
  imports, fully unit-tested (`npm test`, 73 tests as of end of Session 2,
  `node:test`): repeating pattern resolution (`pattern.ts`), DST-safe
  local-time→UTC conversion (`intervals.ts`), the hard per-week-hours rule
  (`weeklyHours.ts`), the childcare allowance incl. the strict pickup-age
  rule (`childcare.ts` — see §9.9), school-day lookup incl. per-term weekdays
  (`school.ts`), days-off-together (`daysOffTogether.ts`), a static UK
  bank-holiday table (`bankHolidays.ts` — hand-maintained, update yearly from
  gov.uk), the Mum shift optimiser (`mumOptimiser.ts` — see §9.2).
- **`src/lib/calendarService.ts`** — the one place that merges a parent's
  active pattern version + any manual `WorkShift` override + a child's
  school status into a single per-day view (`getCalendarRange`). Pattern
  versions are matched to dates by `effectiveFrom`, not just "whichever is
  newest" — editing Dad's rota today does not retroactively change what last
  month's calendar showed (see the code comment there for why this matters).
- Plain CSS (`src/app/globals.css`), no component library — deliberate, per
  the founder's "don't over-engineer the UI" instruction.

## 4. Current live state (STALE — see §9 for what's actually true as of Session 2)

This section describes first-deploy state only. Short version of what changed:
the household is no longer empty (§9.6), the childcare engine is wired into
the UI (§9.1), and a Mum shift optimiser + school-calendar importer were built
(§9.2-9.4) — all ahead of the `TODO.md` phase schedule below. Read §9.

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

`TODO.md` in the repo has **not been updated since Session 2** and is stale
for the Phase 2 items §9 below completed (Mum's shift optimiser and childcare
conflict detection are done, ahead of schedule). Still genuinely open, per
`TODO.md`'s Phase 2-5 breakdown: the What-If planner, the annual-leave/
holiday-bridging finder, the Jarvis REST + MCP API, API keys, PWA/kiosk mode,
notifications, ICS/backup export, and the photo/PDF importer needs an
`ANTHROPIC_API_KEY` to actually work end-to-end (§9.4, §1). Worth updating
`TODO.md` itself in a future session so it stops undercounting what's done.

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
8. **`src/lib/prisma.ts` deliberately appends `pgbouncer=true` to the runtime
   connection string — never remove this.** Session 2 caused (and then fixed)
   a real production outage: Supabase's pooled `POSTGRES_URL` runs through
   PgBouncer in transaction mode, where a query can land on a different
   backend Postgres connection than the one before it. Prisma's default named/
   cached prepared statements then collide with a same-named statement a
   different client already prepared on that connection, and Postgres rejects
   it with `42P05 prepared statement already exists`. This broke nearly every
   API route in production (96 errors, 4 real users, ~2 hours) before the fix
   went in (commit `e1ab303`). `pgbouncer=true` tells Prisma to stop using
   named prepared statements, which is Prisma's own documented fix and is a
   no-op against a non-pooled connection — so if a future refactor of
   `prisma.ts` "simplifies" this away, the outage comes straight back. See the
   comment in that file for the full mechanism.
9. **This session pushed feature commits straight to `main`**, not through a
   PR, because the founder was actively testing the live site in real time and
   wanted each fix/feature usable within minutes. The `claude/gret-residence-
   rota-complete-xv4094` branch was kept as a mirror of `main` (pushed to
   both, in that order) rather than used as a staging branch. This was a
   speed/safety tradeoff appropriate to that moment (Phase 1 already live,
   the founder actively watching), not a house rule — a future session should
   ask the founder whether to keep working this way or move to a PR-based
   flow now that real family data and daily use exist and an untested push can
   affect them immediately.

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

1. `git clone` this repo, `git log -10 --oneline` to see what's actually
   committed (should show Session 2's 8 commits — §9.1 — on top of the
   Session 1 baseline).
2. Read `docs/ARCHITECTURE.md`, then `TODO.md` for what's left — but see §5,
   `TODO.md` undercounts what's done as of Session 2.
3. Confirm what's actually live: check the Vercel project's latest
   deployment matches the repo's `main` HEAD before assuming they match.
4. Do not attempt to read back `SETUP_TOKEN`, `SESSION_SECRET` or
   `ANTHROPIC_API_KEY` — per §6.2, it's not possible for a "sensitive" env
   var, and it's not necessary once the household exists.
5. Never touch `siteroster` from a session working on this repo, or vice
   versa — they're deliberately separate, unrelated projects that happen to
   share a GitHub owner and a Vercel team.
6. **A real household's real data now lives in the production database**
   (§9.6) — the founder is actively using this day-to-day. Never truncate,
   reset, or run destructive migrations against it without asking first, even
   for testing. If you need to test against real-shaped data, build it
   locally (§9.7 has the exact recipe used this session) rather than touching
   production.
7. Check `git log` for anything after this document's "Last updated" line —
   if there's a Session 3+, treat this file's §9 as historical and prefer
   whatever a later session recorded.

---

## 9. Session 2 (2026-09-27, later the same day): what changed

The founder came back after first deploy having actually used the site, with
one very concrete critique: it looked confidently right but was often wrong
(false "both parents off" days, a rota that only started showing from today).
Everything below followed from fixing that trust problem, then building
toward the founder's real stated goal — **more time off together as a
couple** — not just feature-completeness against the original brief.

### 9.1 Commits, in order

All pushed to both `main` and `claude/gret-residence-rota-complete-xv4094`
(kept as mirrors — see gotcha #9 in §6 on why no PR was used):

1. `abcbf97` — Fixed the trust problem: "both parents off" (and therefore
   days-off-together, and the month view's pink highlight) now requires every
   parent's status to be *positively known* for that day, not merely
   defaulted to off when a parent has no rota/shift entry yet. A first-saved
   rota now takes effect from its own anchor date instead of only from
   "today" (a correction still only applies from today on, preserving
   history). Wired the already-tested childcare engine into the calendar for
   the first time (plain-English conflict banners on Today/Week, a red dot on
   Month).
2. `bc585cb` — Built the Mum shift optimiser (`src/lib/engine/mumOptimiser.ts`,
   `src/lib/optimiserService.ts`, `POST/GET /api/insights/plan-mum-week`,
   `PlanWeekSheet.tsx`): a deterministic (no AI) ranked search over real shift
   combinations that hits the hard weekly-hours requirement exactly,
   respecting locked days. Added day-locking to the Add sheet.
3. `3b44ee3` — **Retuned the optimiser's whole ranking priority** after the
   founder explained the actual goal: more days off *together*, which their
   wife "could not optimise for" manually. The first version penalised "both
   parents working" as bad; the new ranking instead maximises shared time off
   (and specifically "couple daytime while the kids are at school" as the
   premium outcome) after the two hard constraints (exact hours, no childcare
   conflicts) — a day both parents work while school covers the kids now
   *protects* a day off elsewhere rather than being penalised on its own. Also
   this commit: per-term `weekdays` (so a nursery place that's only Tue/Wed/
   Thu is modelled correctly — the founder's actual 3-year-old's real
   schedule, until end of January), a deterministic text-paste school-calendar
   importer with a mandatory review screen, and "Plan the month" alongside
   "Plan the week".
4. `ca09518` — The founder pointed out Mum could do 9am-4pm on the nursery's
   in-school days. That exposed a real gap: the childcare allowance's
   "supervisor-age child can cover" rule was whole-day only, so a shift ending
   shortly after school pickup was wrongly flagged as a childcare conflict,
   which would have stopped the optimiser ever recommending it. Fixed by
   making the allowance time-aware (before/after school hours specifically,
   not just whole days off) — confirmed with a test that the optimiser now
   places such a shift on the other parent's working days, which is what
   actually frees up their days off for the couple.
5. `e1ab303` — **Production incident and fix.** Not planned work — the
   founder hit a stuck "Loading…" on Settings while testing live. Root cause
   and fix are gotcha #8 in §6; read that before touching `src/lib/prisma.ts`.
6. `36f513d` — Photo/PDF school-calendar import via AI vision (the founder's
   ask: pasted text was getting garbled — see §9.5 for an unresolved example).
   Full details in §9.4. Inert without `ANTHROPIC_API_KEY` (§1) but fails
   gracefully (clear message, other features unaffected) without one.
7. `1e4f41a` — Day/night colours per parent, plus a paint-style quick-fill
   tool on the Month calendar for bulk shift entry. Full details in §9.8.
8. `d7892b5` — A strict drop-off/pick-up rule for a young child (a
   supervisor-age sibling is no longer automatically enough for *that*
   child's own school run), plus self-service editing of a parent's weekly
   hours and a school's times after creation. Full details in §9.9.

### 9.2 Mum shift optimiser — what it actually optimises for and why

Read `src/lib/engine/mumOptimiser.ts`'s top comment for the exact rank order.
The short version: exact weekly hours and zero childcare conflicts are hard
constraints; everything after that maximises `coupleDaytimeOff` (both parents
off while the kids are at school — this is the outcome the founder actually
wants) then total shared days off, then minimises handovers and fragmentation.
It deliberately does **not** penalise "both parents working" as its own
metric — that was the first version's mistake, corrected in `3b44ee3` (§9.1
item 3) once the founder explained why: pushing Mum's shifts onto Dad's days
off *destroys* shared time, it doesn't protect it.

`src/lib/engine/coverage.ts` computes a parent's at-home minutes for a day,
correctly handling an overnight shift from the night before spilling into the
morning. `src/lib/optimiserService.ts` is the only place that turns real
household data (patterns, manual shifts, school terms, the childcare rule,
ages) into the engine's plain input shape — the engine itself never touches
Prisma. `PlanWeekSheet.tsx` is used from both the Week page ("Plan the week")
and Month page ("Plan the month" — runs the engine once per calendar week and
can apply all of them in one tap).

### 9.3 Childcare conflict detection — now live, and now time-aware

`src/lib/engine/childcare.ts`'s `childcareStatus` takes a `supervisorHome:
DayInterval[]` (a supervisor-age child's at-home minutes: before/after school
on a school day, or the whole day when they're off school) rather than a
day-level "is the 13-year-old off today" boolean. This is what lets a shift
ending shortly after school pickup count as a HANDOVER instead of a false
CHILDCARE_NEEDED. Both `calendarService.ts` (for the live calendar) and
`optimiserService.ts` (for shift planning) compute this the same way from each
supervisor-age child's school hours — if you add a third place that needs
childcare status, compute `supervisorHome` intervals the same way rather than
reintroducing a whole-day boolean.

### 9.4 School-calendar importer — text is live, photo/PDF needs a key

Two import paths, both feeding the *same* mandatory review screen
(`SchoolsSection.tsx`) before anything is saved — nothing is ever written
straight from either path:

- **Paste/type text** (`src/lib/schoolImport.ts`'s `parseSchoolCalendarText`)
  — fully deterministic, no AI, works right now. Reads common school phrasing
  ("School opens - 7 September 2026" / "Break up - ...", explicit ranges,
  numeric/ISO/text dates, infers the year from an academic-year hint when the
  source omits it). Unrecognised lines are surfaced, never silently dropped.
- **Photo/PDF upload** (`src/lib/schoolVisionImport.ts`, `POST
  /api/schools/import-vision`) — calls the Anthropic API server-side
  (`claude-sonnet-5` by default, `ANTHROPIC_MODEL` overrides it) with a
  strict tool schema forcing structured output. **Needs `ANTHROPIC_API_KEY`
  set on Vercel to actually work** (§1) — the founder said they'd sort this
  themselves; don't chase it unless asked. Until it's set, the endpoint
  returns a clear 501 ("Photo/PDF import isn't set up... use Import from text
  for now") rather than failing obscurely, and every other feature is
  unaffected.
  `validateVisionBlocks` (`src/lib/schoolImport.ts`) is the important part to
  understand before touching this: it is the one boundary between untrusted AI
  output and the database. It never trusts a model's own "high confidence"
  claim — a block only keeps "high" when both dates parsed as real dates AND
  start ≤ end; anything else is downgraded to "review" and reported as a
  warning, with the date itself coming through as `null` (an empty, must-fill
  field) rather than a guessed value. This function is pure and has its own
  unit tests independent of the network call, precisely so the "never invent
  a date" guarantee doesn't depend on trusting the AI response — it's
  re-checked in code regardless of what the model claims.
  Client-side, a phone photo gets resized/recompressed in-browser (via
  canvas) before upload, since a raw phone photo is routinely 5-10MB —
  comfortably over what a Vercel serverless function's request body allows.
  PDFs aren't recompressed (harder to shrink client-side); an oversized PDF is
  rejected client- and server-side with a message suggesting a screenshot
  instead.

### 9.5 Known follow-up bug — NOT fixed this session

While testing the *text* importer live, the founder pasted a real term sheet
and one entry came out as a garbled merged label — `"Summer Holidays Break up
Friday"` as a single HOLIDAY block dated `23/07/2027–23/07/2027`, flagged
"Review recommended." This looks like `parseSchoolCalendarText`'s classifier
merging what were probably two separate source lines (a holiday-name line and
a "break up Friday ..." line) because of how the pasted text wrapped or was
laid out — the review screen caught it and it wasn't imported wrong, but the
parse itself should be more robust. **Not diagnosed or fixed this session**
(ran out of time before the founder had to go) — a good next task, ideally
starting from the founder's actual pasted source text (ask them to re-paste
what they used) so the exact wrapping/formatting that broke it can become a
test case.

### 9.6 Real state as of end of Session 2

Live production database now has a real household (not test data): the
founder's family, work patterns, at least one school and one nursery with
term dates, and Mum's shift types including a 9-4. **This is real data a real
family depends on** — see §8 item 6. The founder was mid-session ("ill put
some figures in and have a play around") when this session ended; expect the
data to keep changing without another handoff update recording it.

### 9.7 How this session verified changes before shipping

Vercel deploys straight from `main` with no separate staging environment
(§6 gotcha #9), so this session needed a way to test against a real
Postgres before every push. Recipe used (this container's local Postgres does
not persist between sessions, so a future session needs to redo this, not
resume it): `initdb`/`pg_ctl` run as the `postgres` system user (Postgres
refuses to run as root) on a Unix socket in a scratch directory, `prisma
migrate deploy` against it, `npm run build && npm run start`, then either
direct `curl` with a saved session cookie or a small Playwright script
driving a real browser at phone viewport size — screenshots were the main way
bugs (like the original false "both parents off" pink month) were actually
*seen*, not just reasoned about. Every commit in §9.1 was validated this way
plus `npm test` (58 tests by end of session, up from 27 at first deploy),
`tsc --noEmit`, `eslint`, and a full `next build` before pushing.

### 9.8 Day/night colours per parent, and the Month quick-fill paint tool

Two UX requests, both from live use: colour-code each parent's day vs night
shifts distinctly (previously every shift for a parent was one flat colour,
day or night indistinguishable at a glance), and replace the multi-tap
Add-sheet flow for entering a run of shifts with a tap-to-paint tool directly
on the calendar.

- `FamilyMember` gained optional `dayColor`/`nightColor`/`dayStartLocal`/
  `dayEndLocal`/`nightStartLocal`/`nightEndLocal` (additive migration, all
  nullable). `src/lib/quickShift.ts` resolves the actual colour/time to use,
  with sensible defaults before anyone visits Settings: the "dad" palette
  slot (whoever ran `/setup`) defaults to orange (day)/blue (night), the
  "mum" slot to pink (day)/purple (night) — these are palette-*order*
  defaults, not a hardcoded assumption about which parent is which, and are
  fully overridable per parent.
- `calendarService.ts` classifies each parent's resolved shift as DAY or
  NIGHT purely from its times (the same "end ≤ start means overnight"
  convention `intervals.ts`/`coverage.ts` already use) and resolves a
  `displayColor` that Today/Week/Month now render instead of the old single
  per-member colour. Settings → Family members has a colour-and-time editor
  per parent (native colour pickers + time inputs, via the existing PATCH
  endpoint extended to accept these fields).
- **Quick-fill paint tool** (Month calendar): pick a parent, then
  Days/Nights/Off/Holiday, then tap dates on the calendar above to mark them
  (tap a marked date again to undo it), then Save applies everything in one
  go — nothing is written until Save, and Cancel discards all pending marks.
  "Days"/"Nights" write the parent's quick-fill colour/time config as a plain
  custom shift; "Off"/"Holiday" reuse the exact same semantics as the
  existing Add sheet's Off/Annual-leave options, so there's exactly one code
  path for what an "off" or "holiday" day means, not two. Pending (unsaved)
  taps render as a coloured ring + corner dot, visually distinct from
  already-saved shifts, so what's about to change is always visible before
  committing.

### 9.9 Strict drop-off/pick-up rule for a young child

The founder's actual situation changed mid-session: the 3-year-old's nursery
became Mon-Fri, and — critically — an older sibling being home is **not**
enough for that specific child's own drop-off/pick-up; it has to be an adult,
even though the same sibling is a perfectly fine supervisor the rest of the
time (e.g. a normal evening gap). That's a genuine rule change, not just a
data change, so it went into the engine rather than being worked around in
the UI:

- `childcare.ts` gained `subtractIntervals` (generic interval subtraction)
  and `pickupDutyWindows` (the configurable buffer immediately before/after
  school start/end — empty on a day the child isn't at school, since there's
  no school run and so no special rule that day).
- `ChildcareRule` gained `strictPickupAge` (below this age, the
  sibling-supervisor allowance is carved out during *that child's own*
  pickup buffer; `null` disables it entirely — every existing household is
  unaffected until it opts in) and `pickupBufferMinutes` (default 30).
  Additive migration. Settings → Childcare rule has both fields, with an
  explanation of what they do.
- `calendarService.ts` and `optimiserService.ts` both compute the same
  restricted `supervisorHome` — this is the household's own documented
  invariant (see §9.3): every call site that needs childcare status computes
  `supervisorHome` the same way, never a bespoke whole-day boolean. The Mum
  optimiser therefore automatically avoids/penalises a week that would leave
  the young child's pickup uncovered, with no change to its own ranking
  logic — `childcareConflicts` was already a near-top priority (§9.2), so it
  just started catching a real case it couldn't see before.
- Separately (needed to actually apply the above to real data): Settings can
  now edit an existing parent's weekly-hours requirement, and an existing
  school's hours, **in place** — both were previously only settable at
  creation, a real self-service gap once the founder started actively
  tuning the household's real numbers.

### 9.10 Genuinely still open (superseding §5 for what's left)

Not started: What-If planner, 🏖️ annual-leave/holiday-bridging optimiser,
Jarvis REST + MCP API, API keys, PWA/kiosk mode, notifications, ICS/calendar
export, backups. Started but incomplete: photo/PDF import (built, needs the
API key — §9.4); the text-importer parser bug (§9.5). `TODO.md` itself was
not updated this session and should be reconciled against this list.

---

## 10. Session 3 (2026-09-27, afternoon): 17 commits, never written up

Session 3 shipped a run of changes straight to `main` and ended without
updating this file. Reconstructed from `git log cccb28e..c4671d3`, oldest first:

- `b1c91d4` Bigger, initialled shift colours on Month; the plan sheet stays
  open across weeks instead of closing on each apply.
- `7c93624` Minimum-rest rule in the optimiser (`MIN_REST_MINUTES`, 11 hours,
  mirroring the Working Time Regulations) so it can never suggest a night
  shift running into the next morning's long day.
- `ec047d6` "Plan the month" chains each week's suggested Sunday into the next
  week's "day before", so a multi-week plan can see its own proposals.
- `f873cda` Self-service editing of a member's own name, and a child's date of
  birth and school.
- `ff84f5c` Settings loaded via one `/api/settings/bootstrap` call instead of
  five or six — it was visibly slow to open.
- `67b6d94`, `82e2da4` The calendar explains WHY a day isn't a school day, and
  defaults an unfilled shift-type day to Off.
- `c3f9ec7` A school can be deleted.
- `1a584ca` Month view no longer overflows the right edge on a phone.
- `6055560` The "days off together" highlight colour is configurable
  (`/api/settings/appearance`).
- `7f662c7` A family member can be given their own login (`/api/users`).
- `66e7c84`, `ab4179f` The plan sheet shows the other parent's own shift in a
  real column alongside each suggestion.
- `085afff` Conflict days turn fully red on Month; first attempt at the hard
  rule that a school-day morning handover needs an adult. **See §11 — that rule
  was real in its unit test and inert in production.**
- `ae846c2` The optimiser loads household data once per request, not once per
  week — the prerequisite for planning a year.
- `8369eea` "Plan the year" alongside "Plan the month".
- `c4671d3` The school-holiday exception applied to the optimiser too, not just
  the Month calendar's own check.

---

## 11. Session 4 (2026-09-27, late): the scheduler rebuilt on a continuous timeline

This session worked from a detailed written brief (kept at
`D:\Downloads\family_rota_scheduler_full_fix_and_audit_prompt.md` on the
founder's machine) asking for a deep fix and audit of the scheduling engine,
with an independent CodeRabbit review as a second phase. The work is on the
branch `fix/continuous-timeline-scheduler` and is **not yet merged or
deployed** — see §11.6.

### 11.1 The one root cause

Every scheduling bug in the brief came from the same thing: **the calendar day
was the unit of reasoning.** Shifts were cut in half at midnight, childcare was
judged one day at a time, and each week was planned in isolation. Weekly cards
were never the real boundary — midnight was.

Two bugs, both proved by running the old code before changing anything:

1. **The unattended allowance reset at midnight.** Both parents out from 21:00
   to 03:00 is one continuous six-hour stretch with the children alone. The
   engine saw a three-hour gap on Tuesday and a three-hour gap on Wednesday,
   judged each against the three-hour allowance, and called both acceptable.
   Nothing ever saw six hours.
2. **The school-morning rule never fired in production.** The brief's own worked
   example (one parent leaving at 06:00, the other's night shift ending at 08:00,
   an ordinary school day) returned HANDOVER, not a conflict. `childcareStatus`
   excused any gap a supervisor-age sibling was home for, and the real
   `calendarService` reported the 13-year-old as home for the whole pre-school
   morning. The unit test asserting this case passed only because it hand-fed an
   afternoon-only window that production never produced — a test passing for the
   wrong reason.

### 11.2 What replaced it

`src/lib/engine/timeline.ts` — **the one childcare validator.** The live
calendar, the optimiser's candidate scoring, and the check made when a plan is
applied all go through `evaluateTimeline`. There is deliberately one
implementation of the household's rules; the previous arrangement let the
calendar and the planner enforce subtly different ones.

- `src/lib/engine/segments.ts` — interval algebra on an unbounded minute axis. A
  span can start on Sunday evening and end on Monday morning and still be ONE
  span. `childcare.ts` now delegates its day-level helpers to this, so there is a
  single implementation of the arithmetic.
- `src/lib/engine/householdDay.ts` — `buildTimelineDay`, the single place that
  turns a day's raw household facts into validator input. **Both**
  `calendarService` and `optimiserService` call it. This is the structural fix
  for §11.1's second bug: the two used to build sixty near-identical lines each,
  and a rule tightened in one stayed loose in the other.
- Gap lengths are **real elapsed minutes**, converted through the timezone, so
  the night the clocks change is an hour longer or shorter exactly as it is in
  life.
- Every window carries a **context day either side** (`CONTEXT_DAYS` in
  `optimiserService.ts`). The leading one already existed; the trailing one is
  new, and is what makes a Sunday night shift running into Monday morning
  visible at all. Chaining weeks together was never enough on its own — the last
  week's Sunday still ran into a Monday nobody was planning.
- `childcareStatus` and `coverage.ts` are **deleted**. Don't reintroduce a
  day-level childcare judge: that shape is the bug.

### 11.3 Rules that changed, and what the founder will see

- **A school day is no longer covered all day.** For any child who actually
  attends, an adult must be home from a configurable morning time until school
  starts, and for a buffer after it ends. Neither an older sibling nor the
  three-hour allowance substitutes for that part of the day.
  New setting: `ChildcareRule.schoolRunMorningFromLocal` (defaults to `06:00`,
  additive migration `20260927190000_add_school_run_morning_from`), editable in
  Settings → Childcare rule alongside the existing after-school buffer.
- `strictPickupAge` still works exactly as before and was deliberately NOT
  retired. The broader rule subsumes it in most configurations, but the founder
  configured it on purpose and it still carves the sibling allowance for a child
  whose school hours differ from a sibling's.
- **Childcare is a hard constraint in the optimiser, not a ranking term.**
  Candidates with any conflict are removed before scoring, so no score can
  promote an unsafe plan. `rankKey` no longer mentions conflicts at all.
- When the hours can only be reached by accepting a gap, the optimiser returns
  the safe plan as `best` AND the exact-hours plan as `bestWithConflicts`, with a
  message naming the trade-off. Applying the unsafe one takes a deliberate second
  action. When nothing is safe at all, `best` is null and the reason is given.
- The plan sheet states the childcare verdict once for the WHOLE plan. A
  per-week "no childcare conflicts" claim is a claim about that week only, which
  is how a conflict spanning two weeks could hide between two reassuring cards.
- **Expect more red days on the live calendar than before.** School mornings and
  after-school gaps that an older sibling being home used to excuse are now
  genuine conflicts. That is the intended change, and the most visible one.

### 11.4 Applying a plan is now validated server-side

`applyMumWeekPlan` re-checks the assignments through the same validator before
writing anything, and refuses with a 409 unless `allowConflicts: true` is
passed. The writes go through one `prisma.$transaction` instead of a
`findUnique` plus an `upsert` per day, so a year's plan is no longer hundreds of
sequential round trips and a half-applied week can't exist.
`validateAssignments` is exported for anything else needing the same check.

### 11.5 Tests: 116, up from 88

- `tests/timeline.test.ts` — the brief's regression list: cross-week, month and
  year boundaries; a gap crossing midnight; pre-school, after-school and
  inside-school-hours overlaps; the asymmetry between "day + night" and "night +
  day"; weekend 2h versus 3h01m to the minute; INSET days and bank holidays
  inside term time; both window edges; and both DST transitions.
- `tests/householdDay.test.ts` — pins the input shapes, including an explicit
  test that the sibling IS recorded as home before school, so it is the
  adult-only window doing the work and not a quirk of the inputs.
- `tests/applyPlan.integration.test.ts` — the only test that touches a database:
  plan, apply, read back, and confirm the calendar agrees; plus that an unsafe
  apply is refused and writes nothing. Skips when `POSTGRES_URL` isn't set.
- Every test builds its days through `buildTimelineDay`, on purpose. Hand-fed
  inputs are what hid §11.1's second bug.
- **A real bug was found in `localDateTimeToUtc` while writing these**: it
  sampled the timezone offset at UTC noon of the date, so 00:30 on the morning
  the clocks go forward was treated as BST when it is still GMT. It now resolves
  in two passes. That module was previously called only by its own tests; the
  live path depends on it now.

### 11.6 Where this was left

- On branch `fix/continuous-timeline-scheduler`, committed, **not pushed and not
  merged.** The founder was asked first, because §6 gotcha #9 records that
  pushes to `main` reach the family within minutes, and this change visibly
  alters what the app tells them about their own week.
- Verified locally: 116/116 tests, `tsc --noEmit` clean, `eslint` clean, a full
  `next build`, and a real seeded household driven through the running app — the
  school-morning conflict caught, the six-hour cross-midnight gap reported
  against both dates, a sensible safe plan produced, and a 409 returned on trying
  to apply an unsafe one.
- **Phase 2 of the brief has not been done**: an independent CodeRabbit audit of
  this change, which was always meant to follow the implementation.
- The local Postgres used for testing lives in that session's scratchpad only and
  will not survive it. The recipe: EnterpriseDB's "binaries only" zip (needs no
  admin rights), `initdb`, run it on a spare port, `prisma migrate deploy`, and a
  `.env` holding `POSTGRES_URL` — which `tests/applyPlan.integration.test.ts`
  picks up via `process.loadEnvFile`.

---

## 12. Session 5 (2026-09-27, evening): timeline work is now LIVE; branch state; feature catch-up

**Read this after §11 — it corrects §11.6 and records the current shipped state.**

### 12.1 The continuous-timeline rebuild is merged and deployed
§11.6 said the rebuild was committed but "not pushed and not merged." That is now
out of date. It **is on `main` as commit `21b2b58` ("Reason over one continuous
timeline, not a day or a week at a time") and is LIVE in production** (Vercel
production deployment READY, no runtime errors in the logs; `vercel-build` ran
`prisma migrate deploy`, so `20260927190000_add_school_run_morning_from` is
applied to the live database). `evaluateTimeline` / `buildTimelineDay` /
`segments.ts` are the live validator; `childcareStatus` and `coverage.ts` remain
deleted — do not reintroduce a day-level judge.

### 12.2 Current branch state (IMPORTANT)
- `main` = `21b2b58` (live).
- Designated dev branch **`claude/gret-residence-rota-complete-xv4094` is reset to
  equal `main`** (`21b2b58`). Develop there, then mirror to `main` to deploy.
- **`git fetch origin main` before every push to `main`.** A parallel session
  pushed `21b2b58` onto `main` mid-work this session, causing a divergence. It was
  resolved by adopting `main` and dropping the divergent commit — never force-push
  over another author's work.

### 12.3 Features that landed on `main` this session (history `1a584ca`..`c4671d3`, below `21b2b58`)
All live. Not all were written up individually before now — this is the catch-up:
- Mobile Month grid overflow fixed (`grid-template-columns: repeat(7, minmax(0,1fr))`
  + `min-width:0`; do not revert to bare `1fr`).
- Customisable **"days off together" colour** — Settings → Appearance, stored in
  `FamilySettings.data.togetherColor` (`/api/settings/appearance`), default yellow.
- **Per-member logins** — `/api/users` (POST create, admin-only) + `/api/users/[id]`
  (DELETE), key-icon UI in `FamilyMembersSection`. Lets e.g. Jeanicar sign in with
  her own credentials instead of sharing the admin's.
- **"Plan the year"** button on the Month page (next to "Plan the month"): runs the
  planner across the next 12 months in one request.
- Optimiser loads household data **once per request** (`loadHouseholdContext` +
  pure `computeWeekPlan`), so year-scale planning is a few queries, not hundreds.
- Plan sheet shows the other parent's own Day/Night/Off in an aligned column with a
  single `HG`-style initials header (`src/lib/initials.ts`).
- School delete (`/api/schools/[id]` DELETE; FK is `ON DELETE SET NULL`), child
  "Home · <reason>" labels (half term / INSET / weekend / bank holiday), and
  variable-parent unfilled days defaulting to "Off".

### 12.4 A safety-first optimiser commit was made, then correctly discarded
Before `21b2b58` was noticed on `main`, this session also wrote a smaller
"childcare safety as the top ranking key + block Apply on unsafe" change on the
**old** architecture (the one that still used `childcareStatus`). `21b2b58`
already does all of that (and far more) the right way, and it deletes the files
that change was built on, so the smaller commit was dropped and the dev branch
reset to `main`. Nothing of value was lost — do not try to resurrect it.

### 12.5 `npm test` in a DB-less sandbox
Expect **114 pass + 2 fail** where the 2 are `tests/applyPlan.integration.test.ts`.
That test only truly skips when `POSTGRES_URL` is unset. If a leftover `.env`
points `POSTGRES_URL` at a local Postgres (per §11.6's recipe) that isn't running
in your environment, the test tries to connect and fails on `127.0.0.1:5433`.
That is environmental, not a regression — all 114 pure-logic tests pass. To run
it for real, stand up the local Postgres per §11.6.

### 12.6 Still open
- **Phase 2 of the scheduler brief** — the independent CodeRabbit audit (§11.6) —
  still not done.
- Optional developer diagnostics on the optimiser (per-run candidate counts:
  total / safe / rejected) to make "no safe plan" provable in the UI. Not required
  for correctness.
- Childcare tuning for the Grets: to force an adult (not the 13-year-old) around
  the youngest's morning routine, set Settings → Childcare rule → "below this age
  an adult must do the school run" above the youngest's age; `schoolRunMorningFromLocal`
  controls when the morning duty starts.

---

## 13. Session 6 (2026-09-27): CodeRabbit C1/H1/S3/H3 follow-up

Implemented and verified locally (125 passing, 4 DB-backed tests skipped without
`POSTGRES_URL`; ESLint and `tsc --noEmit` clean):

- **C1:** `PlanWeekSheet` now types and uses server diagnostics. It keeps the
  absolute “every option leaves a gap” statement only when every no-safe result
  was exhaustively searched. A truncated search states that it was too large to
  check exhaustively and displays generated/safe counts. Per-week server
  messages remain visible above each card.
- **H1:** `workingInterval` now treats a parent with at least one configured
  shift type, no active pattern, and no saved shift as known off — exactly as
  the calendar does. `tests/crossService.test.ts` pins calendar/planner
  agreement for the otherwise-hidden childcare conflict (runs with Postgres).
- **S3:** TERM weekday lists are normalised at the API boundary: empty or
  wholly invalid lists become Monday-Friday, never a silently non-attending
  term. `tests/school.test.ts` pins this.
- **H3:** pattern-version selection, age calculation, time conversion and
  child-day construction now live in `src/lib/householdContext.ts`, used by both
  calendar and optimiser services. Do not duplicate them back into either
  service.

Still deliberately NOT changed: S1/S2. Confirm the UK nation for bank holidays
and whether more than one parent can have a weekly-hours requirement before
altering those rules.

---

## 14. Session 7 (2026-09-28): phone installation + Month UI handoff

### 14.1 Exact deployed state

- Production: `https://gretresidencerota.vercel.app`
- GitHub `main` production commit: **`5c9960c8ea9ce291fbb28d5e186616aff63f8287`**
  (`fix phone installation and tidy calendar header`). Vercel reported success.
- Equivalent local commit in the working clone: **`694cabc`**. The hashes differ
  because production was published through the GitHub object API, but the file
  tree/content is the same.
- Working tree was clean at handoff.

### 14.2 Android/iPhone install failure: root cause and fix

The user's Samsung S24 showed Chrome's **“Install and create shortcut”** sheet,
but **Install** was disabled with “This app cannot be installed”; choosing the
shortcut produced a grey `V` icon with a Chrome badge.

The high-confidence root cause was `src/proxy.ts`: Android's WebAPK service
fetches installation files without the user's session cookie, and Proxy was
returning `307 /login` for the manifest, service worker and icons. This also
blocked Safari's Apple icon when fetched without a session.

`src/proxy.ts` now deliberately makes only these non-sensitive assets public:

- `/manifest.webmanifest`
- `/sw.js`
- `/favicon.ico`
- `/icon.png`
- `/apple-icon.png`
- `/icons/*`

Do **not** make `/month`, `/settings`, or any household data public. Signed-out
verification after deployment returned:

- manifest: `200 application/manifest+json`
- service worker: `200 application/javascript`
- Android 192, 512 and maskable 512 icons: `200 image/png`
- Apple icon: `200 image/png` (source is a real 180×180 PNG)
- `/month`: still `307 /login`, as required

`tests/proxy.test.ts` pins both halves of that contract: install assets public,
rota/settings pages private. Earlier commits in the same sequence added the
manifest icons, network-only service worker (it intentionally caches no private
family data), dedicated Apple icon and an early `beforeinstallprompt` capture in
`src/app/layout.tsx` so React hydration cannot miss Chrome's event.

**User retest still outstanding:** the failure screenshot was taken at 09:54,
before this Proxy fix deployed. Ask the user to remove the old grey shortcut,
fully close/reopen Chrome, open the live site, tap **Install app**, then choose
**Install** (not Create shortcut). If it still fails, obtain a fresh screenshot
and timestamp before changing code again; first suspect Chrome's cached failed
installability state or an existing stale WebAPK. For Jeanicar's iPhone, test in
Safari via Share → Add to Home Screen; the Apple icon is now publicly reachable.

### 14.3 Month calendar cleanup now live

The user supplied a mobile screenshot showing the old `At a glance` copy and a
cramped wrapping legend. The calendar card header was rebuilt:

- `At a glance` and `Solid = school · ring = home` are removed.
- The actual month/year (for example `September 2026`) is centred inside the
  calendar card, so it remains visible after scrolling past the hero.
- Pale previous/next buttons sit directly beside that month heading.
- The colour key is two straight rows: `Shifts` then `School`. Parent shift
  colours are four aligned columns (`HG Day`, `HG Night`, `JG Day`, `JG Night`);
  child markers occupy the school row.
- Live browser verification confirmed the lower arrows changed September →
  October → September, two legend rows rendered, and no `At a glance` remained.

The broader live Month screen already includes the decisions from the preceding
session: Month is the primary view, each date is clickable for full details,
HG/JG off text and yellow cell fills are removed, HG/JG occupy stable first and
second parent lanes, child markers can be hidden in Settings, holiday borders
are blue for Harrie/pink for Jeanicar/split for both, Jeanicar has a Clear month
button, adjacent months are prefetched to reduce switching lag, and optimiser
Review & edit opens as a modal rather than an inline section.

### 14.4 Verification and known environment note

- `npm test`: **127 total; 123 pass; 4 expected DB-backed skips; 0 failures**.
- `npm run lint`: clean.
- `npx tsc --noEmit`: clean.
- Vercel production build/deployment: success.
- A local `npm run build` compiled and type-checked, then stopped while collecting
  API route data because this scratch clone has no `POSTGRES_URL`. That is an
  expected environment limitation; production has the database variable and
  built successfully.

### 14.5 S1/S2 clarification received from the user

The family is in **England**. Jeanicar's requirement is **36 hours every week**.
Harrie described his own work as continuing from his repeating 4-on/4-off rota,
not as a flexible weekly target the optimiser should fill. His wording also said
they have “separate weekly hours requirements”, so do not silently generalise the
planner to multiple flexible owners: re-confirm the intended Harrie constraint
before changing owner selection. The England/Wales bank-holiday table still ends
in 2027 and should be extended from an authoritative GOV.UK source when planning
beyond that year.
