# Home Assistant and Jarvis connection

Our Days remains the source of truth. HA reads it with a separate, revocable key;
there are no passwords, database credentials or tokens in dashboard URLs.
No new environment variables or database migrations are needed.

## 1. Create the connection key

After deploying this branch, sign in as an admin at Our Days → Settings →
Home Assistant & Jarvis. Create a key named “Home Assistant”. Save it when
shown: only its SHA-256 hash is stored. Create a separate key for Jarvis so
that each connection can be revoked independently. Only admins manage keys.
The key's only scope is `calendar:read`; existing write APIs still require
an interactive user session. Revocation takes effect on the next request.

## 2. Add actual calendars in HA

Settings → Devices & services → Add integration → Remote Calendar.
Create three integrations with these URLs, and name them as shown:

| Name | URL |
| --- | --- |
| Our Days Appointments | `https://gretresidencerota.vercel.app/api/integrations/calendar.ics?kind=events` |
| Our Days Shifts | `https://gretresidencerota.vercel.app/api/integrations/calendar.ics?kind=shifts` |
| Our Days Together | `https://gretresidencerota.vercel.app/api/integrations/calendar.ics?kind=together` |

For each, set HTTP Basic username to `our-days` and password to the connection
key. These are genuine calendar entities, usable by HA's calendar card and
calendar-trigger automations. A single URL without `kind` combines all three.
The appointments feed includes all saved events, including activities/holidays.

The feed covers seven days before today through 84 days ahead and updates on
HA's polling schedule. Outside that horizon, open Our Days. Midnight-spanning
shifts and DST use the app's existing timezone conversion; all-day entries have
an exclusive next-day end. Untimed events last all day; timed events lacking an
end are exported with a one-hour display duration. That is a display default,
not a claim about how long an appointment lasts. Recurring events are not
supported by the app's current event editor/service.

## 3. Add shared-time and appointment sensors

In HA `secrets.yaml`, add (substitute your new key):

```yaml
our_days_authorization: "Bearer od_YOUR_KEY"
```

Merge `docs/home-assistant/package.yaml` into HA configuration, or use it as a
package if packages are already configured. Merge existing `rest`/`recorder`
sections rather than duplicating top-level keys. Validate configuration and
restart HA. No key goes into a Lovelace card. Check that `sensor.our_days_summary`
has a timestamp state and calendar attributes.

Add the view in `docs/home-assistant/dashboard.yaml` to your dashboard. Replace
calendar/sensor entity IDs if HA chose different IDs. It provides the monthly
calendar, this week's shared days, next shared day, next appointment and coming
up list. It uses built-in cards, with no HACS dependency. Adjust view width for
your kiosk; the existing HA dashboard is not changed automatically by this repo.

The summary refreshes every five minutes. Its detailed entity is excluded from
recorder to avoid storing large private calendar payloads repeatedly. Summary
cards warn if the data is unavailable or more than 15 minutes old. The Remote
Calendar entities use their own polling interval, so the cards may briefly show
different versions immediately after an edit.

## 4. Jarvis REST access

`GET /api/integrations/summary` with `Authorization: Bearer <key>` returns:

- `week.days`: each family member's shift/school status and saved events.
- `week.rotaDaysOffTogether`: days with no shifts starting for either parent.
- `week.fullDaysOffTogether`: days with no work today or overnight carryover.
- `nextFullDayOffTogether`: next such day within the 60-day lookahead, or null.
- `nextAppointment` and `upcomingEvents` (maximum 50): saved future entries.
- `childcareConflicts`: conflicts from the existing scheduling engine.
- `timezone`, `generatedAt`, `coverage`: freshness and search bounds.

Example (set `OUR_DAYS_KEY` outside source control):

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $OUR_DAYS_KEY" \
  https://gretresidencerota.vercel.app/api/integrations/summary
```

This is a REST integration, not an MCP server. Jarvis can call it directly;
HA's standard calendar/REST integrations do not need MCP. Prefer this smaller
surface until an MCP client is actually needed.

Shared days require at least two configured parents. Blank days for a parent
with shift types remain assumed off, matching the current app; unentered future
shifts can therefore make shared days provisional. A full day excludes work
carried over from the previous evening, but does not infer sleep/recovery after
nights or free time between appointments. Null means none inside the search
window, not that there will never be another day off. Upcoming timed entries
exclude ones whose start has already passed; all-day entries remain for today.

## Validation and rollout

Tests cover invalid/range-limited dates, overnight carryover, missing parent
configuration, timezone-aware event order, ICS escaping/folding, authentication,
key revocation, scope enforcement and household scoping. Build does not require
a live DB. Production data and HA setup require a deployment and an admin key;
never use production DB credentials in HA.

## Review findings / further improvements

The calendar and optimiser already share a continuous childcare timeline with
regression tests. This change reuses the calendar service rather than inventing
another scheduler. It also validates date ranges before calendar DB reads, so
malformed or very large requests fail with 422 rather than errors or excessive
work. Calendar service requests are capped at 370 inclusive days (annual planner
compatibility).

Useful follow-ups, outside this change: explicit “rota confirmed through” dates
for Mum, event recurrence, appointment reminders, session/user revocation,
rate limits for login/setup/API-key management, and a broader per-route audit of
role checks and household ownership on writes. The exported data inherits the
existing calendar's school/childcare rules; this work does not independently
certify the scheduling engine or infer missing shifts.
