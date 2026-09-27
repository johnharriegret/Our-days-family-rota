# Remaining work

> **Reconciled 2026-09-27 (Session 4).** This file had drifted a long way
> behind the code. Everything below marked DONE was shipped in Sessions 2-4;
> the phase headings are kept so the original plan is still readable, but
> `HANDOFF.md` §9-§11 is the accurate record of what exists.
>
> Done since this file was written: childcare conflicts wired into the
> calendar; the shift optimiser built, retuned for shared time off, and
> rebuilt on a continuous timeline with childcare as a hard constraint;
> day/shift locking; per-term weekdays; text and photo/PDF school-calendar
> import; day/night colours and the Month quick-fill tool; plan the week,
> month and year; per-member logins; server-side validation when a plan is
> applied.
>
> Genuinely NOT started: the "What if?" planner, the annual-leave bridging
> optimiser, the Jarvis REST + MCP API and API keys, PWA/kiosk mode,
> notifications, and ICS export/backups.
>
> Also outstanding, from the Session 4 brief: **Phase 2 of that brief, an
> independent CodeRabbit audit of the scheduler rebuild.** And one known bug:
> the text school-calendar importer merged two source lines into one garbled
> entry (`HANDOFF.md` §9.5) - undiagnosed, and needs the founder's original
> pasted text to reproduce.

## The original phased plan

Phase 1 is built: auth/roles, family members, Dad's repeating pattern engine
+ editor, Mum's one-tap shift types + manual entry, school terms, events,
Today/Week/Month calendar, days-off-together, the childcare-rule engine
(`lib/engine/childcare.ts`) with full unit tests but no UI wired to it yet.

See `docs/ARCHITECTURE.md` for the full design these build on.

## Phase 2

- DONE - childcare is wired into the calendar (conflict banners on Today/Week,
  fully red day cells on Month). The engine itself was since rebuilt: see
  `lib/engine/timeline.ts`, not `childcare.ts`, for the rules.
- `lib/engine/mumOptimiser.ts` — the "✨ Plan Mum's Week" constraint search
  (priority order is in the architecture doc §3) + its UI panel and
  `[APPLY PLAN]` flow.
- DONE - day locking in the Add sheet; the optimiser and the apply path both
  refuse to touch a locked day.
- The "What if?" preview sheet.

## Phase 3

- `lib/engine/leaveOptimiser.ts` — the "🏖️ Find Best Holiday" bridging
  search over Dad's OFF blocks + a leave-day budget.
- Dashboard polish once conflict banners and the optimisers exist.

## Phase 4

- `/api/today`, `/api/week`, `/api/calendar`, `/api/family-status`,
  `/api/next-day-off-together`, `/api/shared-days-off`,
  `/api/childcare-conflicts`, `/api/term-dates`, `/api/work-pattern/:member`,
  `/api/weekly-hours/:member`, `/api/holiday-opportunities` — Bearer-token
  auth against the `APIKey` table (schema already has it), read-only.
- `/api/mcp` — MCP streamable-HTTP server wrapping the same service-layer
  functions as the REST routes above, read-only tools only.
- API-keys panel in Settings.
- PWA manifest + service worker, kiosk-mode layout for a wall tablet.

## Phase 5

- Notification architecture (email/push triggers for the events already in
  `lib/engine`'s reach — appointments, "X still needs N hours this week",
  childcare conflicts, first day of a new shift type).
- ICS export, JSON export/backup.
- Automated DB backups.
- Individual-calendar subscription (Google/Apple).
