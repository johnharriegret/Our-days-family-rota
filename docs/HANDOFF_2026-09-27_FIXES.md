# 2026-09-27 planner/context follow-up

Published changes cover C1, H1, S3 and H3:

- The planner UI is honest about truncated searches and shows server messages.
- Shift-type-only parents with a blank day are known off in both planner and calendar.
- Empty TERM weekday selections default to Monday-Friday.
- Shared household context helpers prevent calendar/planner drift.

Verification: npm test (125 passing; database-backed tests skip without a database), npm run lint, and npx tsc --noEmit all pass.

S1/S2 remain intentionally open pending confirmation of the UK nation and whether more than one parent can have weekly-hours requirements.
