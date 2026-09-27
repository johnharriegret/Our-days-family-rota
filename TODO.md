# Remaining work (Phases 2–5)

Phase 1 is built: auth/roles, family members, Dad's repeating pattern engine
+ editor, Mum's one-tap shift types + manual entry, school terms, events,
Today/Week/Month calendar, days-off-together, the childcare-rule engine
(`lib/engine/childcare.ts`) with full unit tests but no UI wired to it yet.

See `docs/ARCHITECTURE.md` for the full design these build on.

## Phase 2

- Wire `lib/engine/childcare.ts` into `calendarService.ts` and show
  SAFE/HANDOVER/CHILDCARE_NEEDED banners on the Week/Month views.
- `lib/engine/mumOptimiser.ts` — the "✨ Plan Mum's Week" constraint search
  (priority order is in the architecture doc §3) + its UI panel and
  `[APPLY PLAN]` flow.
- Day/shift locking UI (the `WorkShift.locked` field already exists).
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
