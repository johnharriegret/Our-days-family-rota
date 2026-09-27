
# Our Days — Family Rota & Calendar Optimiser: Architecture Plan

## Context

You asked for a production-ready family calendar + rota-planning web app: not just a calendar, but something that understands Dad's repeating shift rota, Mum's hard weekly-hours requirement, school terms, and a childcare-coverage rule, and can actively recommend Mum's shifts and the best annual-leave windows. It needs to stay usable by a non-technical user and a 10-year-old, and eventually be queryable by your "Jarvis" assistant and Home Assistant.

There is an existing rough prototype live at `gretresidencerota.vercel.app` ("Our Days"), deployed as a one-off Vercel CLI upload with **no Git history anywhere** — that's why we set up `johnharriegret/our-days-family-rota` as its own private repo, separate from `siteroster`. I pulled back what the Vercel deployment tooling would give me (it truncates large files server-side, so recovery was partial): a `README.md`/`ARCHITECTURE.md` describing the same Phase-1 scope you outlined, a hand-rolled `scrypt` + signed-cookie auth (`lib/auth.ts`), a raw-`postgres` table-bootstrap module (`lib/db.ts`), and a block-based shift-pattern engine (`lib/engine.ts`) that already does the right thing conceptually (anchor date + repeating kind/count/start/end blocks, minute-offsets so night shifts cross midnight cleanly). Two concrete things worth knowing before we build:

1. **The live prototype is almost certainly broken right now**: `lib/db.ts` requires `process.env.DATABASE_URL`, but the Vercel project only has `POSTGRES_URL`/`SUPABASE_*` vars set (no `DATABASE_URL`) — a naming mismatch, not a missing database. The Supabase Postgres instance itself is already provisioned and reachable.
2. The prototype's own `ARCHITECTURE.md` already sketched a bigger schema (Household, ShiftPattern, ShiftType, WorkShift, School, SchoolTerm, Event, AnnualLeave, ChildcareRule) — consistent with what you've now asked for in full, just never built.

Given the size of the full spec, this plan proposes the target architecture end-to-end (so nothing painted-in-a-corner later) but scopes **actual implementation to Phase 1** per your own build order — auth, family members, Dad's engine, Mum's manual shifts, school terms, calendar UI, days-off-together. Phases 2–5 (optimisers, conflict detection, Jarvis API/MCP, PWA, notifications) are designed for here at the data/API level but not written yet.

---

## 1. Stack

- **Next.js 16 (App Router) + TypeScript + React 19** — matches the prototype and your spec.
- **Vercel** hosting, reusing the **existing `gretresidencerota` Vercel project** (once we point its Git integration at the new repo) — this keeps the already-provisioned Supabase Postgres instance and its env vars instead of standing up a second database.
- **Postgres via Prisma** — you asked for "Prisma or equivalent"; Prisma's migration history is the right fit here since (unlike siteroster) we want real tracked migrations from day one. Connects via Supabase's pooled `POSTGRES_URL` (runtime) and `POSTGRES_URL_NON_POOLING` (migrations).
- **Auth**: keep it as simple as the prototype already made it — `scrypt` password hashes + a signed HTTP-only JWT cookie (`jose`), no OAuth/NextAuth ceremony. Extend it with the three roles you asked for (`ADMIN`/`PARENT`/`CHILD`) and a `remember this device` long-lived cookie.
- **lucide-react** icons, plain CSS (the prototype's hand-written `style.css` approach is fine and matches "don't over-engineer the UI" — no component library needed for Phase 1).
- **Testing**: Node's built-in `node:test` + `node:assert` (prototype already used this — zero extra dependency), one suite per engine module, run in CI on every push.

## 2. Database schema (Prisma)

Designed for all 25 spec sections; Phase 1 only *uses* the top portion.

```prisma
model Household {
  id        String   @id @default(cuid())
  timezone  String   @default("Europe/London")
  weekStartsOn Int   @default(1) // 1 = Monday
  createdAt DateTime @default(now())
  members   FamilyMember[]
  users     User[]
  patterns  ShiftPattern[]
  shiftTypes ShiftType[]
  shifts    WorkShift[]
  schools   School[]
  events    Event[]
  leave     AnnualLeaveGrant[]
  childcareRules ChildcareRule[]
  apiKeys   APIKey[]
}

model User {
  id           String   @id @default(cuid())
  householdId  String
  household    Household @relation(fields: [householdId], references: [id])
  familyMemberId String? @unique
  familyMember FamilyMember? @relation(fields: [familyMemberId], references: [id])
  email        String   @unique
  passwordHash String
  role         Role     // ADMIN | PARENT | CHILD
  createdAt    DateTime @default(now())
}
enum Role { ADMIN PARENT CHILD }

model FamilyMember {
  id           String   @id @default(cuid())
  householdId  String
  household    Household @relation(fields: [householdId], references: [id])
  name         String
  kind         MemberKind // PARENT | CHILD
  dateOfBirth  DateTime?
  schoolId     String?
  school       School?   @relation(fields: [schoolId], references: [id])
  colorToken   String    // for the "colour + icon + text" UI identity
  icon         String
  user         User?
}
enum MemberKind { PARENT CHILD }

model ShiftPattern {
  id          String   @id @default(cuid())
  householdId String
  ownerId     String   // FamilyMember.id (Dad, or anyone with a repeating rota)
  anchor      DateTime // date the block sequence starts from
  effectiveFrom DateTime @default(now())
  version     Int      @default(1) // bump on edit; never mutate a past version
  blocks      ShiftBlock[]
}

model ShiftBlock {
  id          String   @id @default(cuid())
  patternId   String
  pattern     ShiftPattern @relation(fields: [patternId], references: [id])
  order       Int          // position in the repeating cycle
  kind        String       // 'D' | 'N' | 'O' | custom code
  count       Int          // how many consecutive days this block covers
  startLocal  String?      // "06:00", null for OFF blocks
  endLocal    String?
}

model ShiftType {
  id          String  @id @default(cuid())
  householdId String
  ownerId     String  // FamilyMember.id (Mum's EARLY/LATE/LONG DAY/...)
  name        String
  startLocal  String
  endLocal    String
  paidMinutes Int
  color       String
}

model WorkShift {
  id          String   @id @default(cuid())
  householdId String
  ownerId     String   // FamilyMember.id
  date        DateTime @db.Date
  shiftTypeId String?  // null for a Dad-engine-generated day (derived, not stored — see §4)
  shiftType   ShiftType? @relation(fields: [shiftTypeId], references: [id])
  customStart String?
  customEnd   String?
  paidMinutes Int?
  source      ShiftSource // MANUAL | PATTERN_OVERRIDE
  locked      Boolean  @default(false)
  note        String?
  @@unique([householdId, ownerId, date])
}
enum ShiftSource { MANUAL PATTERN_OVERRIDE }

model School {
  id            String  @id @default(cuid())
  householdId   String
  name          String
  startLocal    String  @default("08:45")
  endLocal      String  @default("15:15")
  terms         SchoolTerm[]
  members       FamilyMember[]
}

model SchoolTerm {
  id       String   @id @default(cuid())
  schoolId String
  school   School   @relation(fields: [schoolId], references: [id])
  startDate DateTime @db.Date
  endDate   DateTime @db.Date
  type      TermType // TERM | HOLIDAY | INSET | BANK_HOLIDAY
  label     String
}
enum TermType { TERM HOLIDAY INSET BANK_HOLIDAY }

model Event {
  id          String   @id @default(cuid())
  householdId String
  title       String
  memberIds   String[] // FamilyMember ids involved
  date        DateTime @db.Date
  startLocal  String?
  endLocal    String?
  repeatRule  String?  // simple RRULE-lite string, e.g. "WEEKLY;BYDAY=TU"
  category    EventCategory // APPOINTMENT | ACTIVITY | OTHER
}
enum EventCategory { APPOINTMENT ACTIVITY OTHER }

model AnnualLeaveGrant {
  id           String @id @default(cuid())
  householdId  String
  ownerId      String   // FamilyMember.id
  year         Int
  totalMinutes Int      // their annual allowance, in minutes (keeps units consistent with WorkShift)
  usedMinutes  Int      @default(0)
}

model ChildcareRule {
  id              String  @id @default(cuid())
  householdId     String
  maxUnsupervisedMinutes Int   // "3 hours" today, configurable
  appliesWeekends Boolean @default(true)
  minSupervisorAge Int?         // e.g. 13 — a child >= this age counts as supervision
  effectiveFrom   DateTime @default(now())
  // superseding rows are added, not edited in place, so history of "what rule applied when" survives
}

model ScheduleLock {
  id        String @id @default(cuid())
  householdId String
  workShiftId String @unique
  workShift WorkShift @relation(fields: [workShiftId], references: [id])
  reason    String?
}

model FamilySettings {
  householdId String @id
  household   Household @relation(fields: [householdId], references: [id])
  data        Json     // small free-form bag for things that don't need their own table yet
}

model APIKey {
  id          String   @id @default(cuid())
  householdId String
  label       String   // "Jarvis"
  hash        String   // sha256 of the token; token itself shown once at creation
  scopes      String[] @default(["read"])
  createdAt   DateTime @default(now())
  lastUsedAt  DateTime?
  revokedAt   DateTime?
}
```

Notes:
- `WorkShift` covers **both** Mum's manually-entered shifts and any one-off override/lock of a Dad pattern day — the pattern itself is never mutated for a single day; an override row wins for that date (see §4). This directly satisfies "the optimiser must never change locked shifts" and "manual overrides" (§13/§24 of your spec).
- Money-shaped fields (`paidMinutes`, `totalMinutes`) are minutes, not hours-as-float, to avoid floating-point drift in the 37.5h/week check.
- `ChildcareRule` rows are append-only (new row supersedes old) rather than edited in place — you explicitly said rules will change as the kids age, and you'll want to know "what rule applied on that date" historically.

## 3. The scheduling engine (`lib/engine/*`, pure functions, zero DB/UI imports)

This is the direct evolution of the prototype's `lib/engine.ts`, split into focused modules so each is independently unit-testable per your §24 list:

- **`pattern.ts`** — `resolvePatternDay(date, pattern): {kind, startLocal, endLocal} | null`. Walks the repeating block list from `pattern.anchor`, using integer day-offset arithmetic (`Math.round((date - anchor) / DAY_MS)` on UTC-noon-anchored dates, exactly like the prototype's `dayDiff`/`addDays` — this sidesteps DST entirely for *which day it is*). Cycle length = sum of all `block.count`. Handles dates before the anchor via modulo, so "what was Dad doing last month" and "what will he be doing next year" both just work off one pattern row.
- **`intervals.ts`** — converts a resolved shift (local start/end, possibly overnight) into a concrete UTC `[startInstant, endInstant)` for a *specific calendar date*, using `Europe/London` offset lookup (via `Intl.DateTimeFormat` offset trick, same technique the prototype already used — no new dependency). This is the one place DST math happens.
- **`weeklyHours.ts`** — `weeklyHours(weekStartDate, shifts): {requiredMinutes, workedMinutes, remainingMinutes}`. Weeks are hard-bounded (Mon–Sun by default, configurable via `Household.weekStartsOn`) and **never averaged** — this is a direct, literal implementation of your "37.5 hours per week, independently, no averaging across weeks" requirement; the function only ever looks at shifts whose date falls in that one week.
- **`childcare.ts`** — `childcareStatus(date, {dadInterval, mumInterval, schoolInterval, oldestChildHome, rule}): 'SAFE'|'COVERED'|'HANDOVER'|'CONFLICT'`. Computes the gap(s) where neither parent's interval nor school covers a child, checks gap length against `rule.maxUnsupervisedMinutes`, and only allows the 3-hour allowance when `isWeekend(date) || oldestChildHome`. Returns the gap's actual start/end so the UI can print the plain-English explanation your spec shows ("Both parents would be working from 14:00–18:00...").
- **`daysOffTogether.ts`** — pure set-intersection over Dad's/Mum's off-days for a date range; also exposes `nextDayOffTogether(fromDate)`.
- **`leaveOptimiser.ts`** (Phase 3, designed now / built later) — given Dad's pattern + Mum's shifts + school terms + bank holidays + a candidate leave-day budget, finds every maximal run of consecutive non-working days achievable by "spending" N leave days on the gaps between Dad's existing OFF blocks, ranked by `consecutiveDays` (report the actual numbers — leave used, consecutive days, days together, school days missed — never a synthetic score, exactly as you specified).
- **`mumOptimiser.ts`** (Phase 2, designed now / built later) — a constraint search (not ML) over Mum's allowed shift types for a target week: hard-satisfy weekly minutes first, then rank candidate combinations by your ordered priority list (childcare conflicts avoided > works-during-Dad's-OFF > minimise simultaneous-working > maximise at-least-one-parent-home > preserve family days > minimise fragmentation), skipping any day flagged `locked`. Returns top 1 + up to 3 alternates with the metrics shown, never auto-applies.

Every function above takes plain data in and returns plain data out — no `fetch`, no Prisma client — so the `node:test` suite can construct a `ShiftPattern`/`ChildcareRule` fixture directly and assert on results, matching your explicit "calendar calculations should be deterministic and testable" rule.

## 4. Timezone / BST-GMT — the one real judgement call

Storing wall-clock local times (e.g. "06:00–18:00") and re-deriving the UTC instant per calendar date (via `intervals.ts` above) is correct for *placing* a shift on the calendar across a DST change. The open question is **what "12-hour shift" means on the two clock-change nights a year**: on the March night the shift crosses 01:00→02:00 (loses an hour of wall-clock, so 18:00–06:00 is actually 11 real hours) and the October night gains one (13 real hours). I'd default to: **paid minutes stay at the shift type's configured nominal value** (a night shift is always paid as 720 minutes) regardless of the clock change, since that's how shift pay almost always works in practice — but flag this because it's a real assumption. Happy to instead compute true elapsed wall-clock minutes if that's how the workplace actually pays it.

## 5. REST API (Phase 1 builds the human-facing routes; Jarvis-facing ones below are Phase 4 but the shapes are fixed now so Phase 1's DB layer doesn't need reshaping later)

Phase 1: `/api/auth/*` (login/logout/setup), `/api/family-members`, `/api/patterns`, `/api/shifts` (CRUD, respects `locked`), `/api/schools`, `/api/terms`, `/api/events`, `/api/settings`.

Phase 4 (designed, not built): the exact endpoints from your spec (`/api/today`, `/api/week`, `/api/calendar`, `/api/family-status`, `/api/next-day-off-together`, `/api/shared-days-off`, `/api/childcare-conflicts`, `/api/term-dates`, `/api/work-pattern/:member`, `/api/weekly-hours/:member`, `/api/holiday-opportunities`), authenticated by `Authorization: Bearer <APIKey token>` checked against `APIKey.hash`, scoped read-only, every response the clean structured JSON shape you specified.

## 6. MCP interface (Phase 4, designed now)

A single `/api/mcp` Next.js route speaking MCP's streamable-HTTP transport (`@modelcontextprotocol/sdk`), authenticated the same way as the REST API. Its tools are thin wrappers calling the exact same service-layer functions as the REST routes (no logic duplication): `get_today_family_status`, `get_family_schedule`, `get_next_shared_day_off`, `get_shared_days_off`, `get_mum_weekly_hours`, `get_childcare_conflicts`, `get_school_term_dates`, `find_best_annual_leave`, `suggest_mum_shifts`, `get_upcoming_events` — all read-only, matching your explicit "no write without a deliberate authenticated mechanism" instruction.

## 7. Screen map (Phase 1)

- **Login** → single email+password form; `SETUP_TOKEN`-gated first-admin creation (kept from the prototype — simplest possible bootstrap).
- **Today** (default landing): "Good morning" card — each person's status, next shared day off, upcoming item, exactly like your §11 example.
- **Week** (default calendar view on mobile): 7-day grid, one row per family member (colour + icon + text per your §9 example), both-off days visually flagged.
- **Month**: same rows, condensed.
- **+ Add** (floating action button): big person-picker → big type-picker (WORK/OFF/SCHOOL/APPOINTMENT/ACTIVITY/HOLIDAY/ANNUAL LEAVE/OTHER) → minimal form. Mum's common shift buttons (EARLY/LATE/LONG DAY/NIGHT/CUSTOM/ANNUAL LEAVE/OFF) are one tap each once configured in Settings.
- **Settings**: family members, Dad's pattern editor (block list + anchor date), Mum's shift-type editor, school terms (entered as date-range blocks per your example), childcare rule, household basics.

Phases 2–3 add: conflict banners on Week/Month, "✨ Plan Mum's Week" and "🏖️ Find Best Holiday" panels, "What-if" preview sheet. Phase 4 adds an API-keys panel in Settings. None of this is built in Phase 1, but the screen map above already leaves room for all of it (no Phase-1 screen needs restructuring to fit them in).

## 8. Decisions confirmed

1. **Week boundary** for Mum's 37.5h rule: Monday–Sunday (`Household.weekStartsOn = 1`).
2. **DST-night pay** (§4 above): a shift's paid minutes are always its configured nominal length, regardless of the clock changing that night.
3. **"Oldest child home" test** for the 3-hour rule: the 13-year-old counts as able to supervise any time they are not themselves at school — weekends, school holidays, INSET days, or after 15:15 on a school day.
4. **Bank holidays**: a small hand-maintained static England/Wales table, updated yearly — no external API dependency.

## 9. What I'll actually build in this pass (Phase 1 only, per your own build order)

1. Prisma schema + first migration against the existing Supabase Postgres (reusing `POSTGRES_URL`/`POSTGRES_URL_NON_POOLING`, fixing the `DATABASE_URL`-naming bug from the prototype in the process).
2. Auth (setup-token bootstrap, login, roles, persistent-device cookie).
3. Family member management.
4. Dad's pattern engine + editor.
5. Mum's manual shift entry with configurable one-tap shift types.
6. School/term entry (block-range form).
7. Event entry.
8. Today/Week/Month calendar UI + days-off-together.
9. Unit tests for: pattern generation (incl. before-anchor dates), night-shift-crosses-midnight, weekly-hours independence, school-day lookup, days-off-together, and the DST offset helper.
10. Point the existing `gretresidencerota` Vercel project's Git integration at this new repo (so `git push` auto-deploys to the URL you already have), add `DATABASE_URL` pointing at the same Supabase instance, keep `SESSION_SECRET`/`SETUP_TOKEN`.

Not built this pass (by your own §23 phasing): childcare rule engine's conflict banner UI, Mum's optimiser, leave optimiser, Jarvis REST/MCP surface, PWA/kiosk mode, notifications, ICS export. The schema and engine module boundaries above are shaped so none of that requires reworking Phase 1's foundations.

## Verification

- `npm run test` (the `node:test` suite from §3) must pass before anything is pushed.
- `npm run lint` / `tsc --noEmit` clean.
- Manual pass on a real mobile viewport: add a shift in ≤3 taps, confirm Dad's rota renders correctly across a week that includes a D→N transition and a week spanning the actual next UK clock-change date.
- Confirm against a hand-worked example: your literal `DDDD OOOO / DDDD OOOO / NNNN OOOO` pattern from an arbitrary anchor date, checked by hand for a few dates before and after the anchor.
