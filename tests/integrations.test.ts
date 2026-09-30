import test from "node:test";
import assert from "node:assert/strict";
import { fullDayOff, buildSummary, calendarICS, validateCalendarRange, weekStart } from "../src/lib/integrations/calendar";
import { newIntegrationToken, tokenHash, readIntegrationToken } from "../src/lib/integrations/token";
import type { CalendarDayView, MemberDayEntry } from "../src/lib/clientTypes";

function parent(id: string, start: string | null = null, end: string | null = null): MemberDayEntry {
  return { memberId: id, name: id, shiftId: null, memberKind: "PARENT", colorToken: "blue", icon: "user", label: start ? "Shift" : "Off", startLocal: start, endLocal: end, isOff: !start, locked: false, source: "MANUAL", displayColor: null };
}
function day(date: string, members = [parent("dad"), parent("mum")]): CalendarDayView {
  return { date, members, events: [], bothParentsOff: members.every(m => m.isOff), childcare: null };
}
test("real dates and bounded inclusive ranges", () => {
  validateCalendarRange("2028-02-29", "2028-03-01");
  validateCalendarRange("2026-01-01", "2026-04-03");
  for (const range of [["2027-02-29", "2027-03-01"], ["junk", "2026-10-01"], ["2026-10-02", "2026-10-01"], ["2026-01-01", "2026-04-04"]]) {
    assert.throws(() => validateCalendarRange(range[0], range[1]), RangeError);
  }
  assert.equal(weekStart("2026-09-30", 1), "2026-09-28");
  assert.equal(weekStart("2026-09-30", 0), "2026-09-27");
});
test("shared full days require two configured parents and previous-day context", () => {
  const previous = day("2026-09-29");
  const today = day("2026-09-30");
  assert.equal(fullDayOff(today, previous), true);
  assert.equal(fullDayOff(today), false);
  assert.equal(fullDayOff(day(today.date, [parent("dad")]), previous), false);
  assert.equal(fullDayOff(today, day(previous.date, [parent("dad", "18:00", "06:00"), parent("mum")])), false);
  assert.equal(fullDayOff(today, day(previous.date, [parent("dad", "06:00", "18:00"), parent("mum")])), true);
  const unknown = parent("mum"); unknown.source = "NONE";
  assert.equal(fullDayOff(day(today.date, [parent("dad"), unknown]), previous), false);
  assert.equal(fullDayOff(today, day(previous.date, [parent("dad"), unknown])), false);
});
test("summary uses household week and timezone, excludes passed timed events", () => {
  const days = [day("2026-09-27"), day("2026-09-28"), day("2026-09-29"), day("2026-09-30")];
  days[3].events = [
    { id: "late", title: "Next", startLocal: "15:00", endLocal: null, category: "APPOINTMENT", memberIds: [] },
    { id: "early", title: "Passed", startLocal: "09:00", endLocal: null, category: "APPOINTMENT", memberIds: [] },
    { id: "all", title: "All day", startLocal: null, endLocal: null, category: "ACTIVITY", memberIds: [] },
  ];
  const summary = buildSummary(days, "2026-09-30", "Europe/London", 1, new Date("2026-09-30T11:00:00Z"));
  assert.deepEqual(summary.week.fullDaysOffTogether, ["2026-09-28", "2026-09-29", "2026-09-30"]);
  assert.equal(summary.nextAppointment?.startsAt, "2026-09-30T14:00:00.000Z");
  assert.deepEqual(summary.upcomingEvents.map(e => e.id), ["all", "late"]);
});
test("ICS escapes private titles, folds UTF-8, and exports overnight shifts in UTC", () => {
  const days = [day("2026-07-20"), day("2026-07-21", [parent("dad", "18:00", "06:00"), parent("mum")]), day("2026-07-22")];
  days[1].events = [{ id: "a", title: "Dentist, check;\nBEGIN:VEVENT" + "🦷".repeat(80), startLocal: null, endLocal: null, category: "APPOINTMENT", memberIds: [] }];
  const ics = calendarICS(days, "Europe/London", new Date("2026-07-20T00:00:00Z"));
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /Dentist\\, check\\;\\nBEGIN:VEVENT/);
  assert.match(ics, /DTSTART:20260721T170000Z\r\nDTEND:20260722T050000Z/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260721\r\nDTEND;VALUE=DATE:20260722/);
  assert.doesNotMatch(ics, /UID:together-2026-07-22/);
  assert.ok(ics.split("\r\n").every(line => Buffer.byteLength(line) <= 75));
  assert.doesNotMatch(calendarICS(days, "Europe/London", undefined, "events"), /UID:shift-/);
  assert.doesNotMatch(calendarICS(days, "Europe/London", undefined, "shifts"), /UID:event-/);
});
test("keys are random, hashed, and basic auth is only allowed explicitly", () => {
  const token = newIntegrationToken();
  assert.notEqual(token, newIntegrationToken());
  assert.equal(tokenHash(token).length, 64);
  assert.equal(readIntegrationToken(`Bearer ${token}`), token);
  const basic = `Basic ${Buffer.from(`our-days:${token}`).toString("base64")}`;
  assert.equal(readIntegrationToken(basic), null);
  assert.equal(readIntegrationToken(basic, true), token);
  assert.equal(readIntegrationToken("Bearer password"), null);
  assert.equal(readIntegrationToken(null), null);
});
test("auth rejects missing/revoked/wrong-scope keys and resolves household from hash", async t => {
  // Isolated test-process fixture: no database credentials or network required.
  process.env.POSTGRES_URL = "postgresql://test:test@localhost:5432/test";
  const { prisma } = await import("../src/lib/prisma");
  const { requireIntegrationKey } = await import("../src/lib/integrations/auth");
  const token = newIntegrationToken();
  let stored: object | null = { id: "key", householdId: "household-a", scopes: ["calendar:read"], revokedAt: null, lastUsedAt: new Date() };
  const original = prisma.aPIKey.findUnique;
  prisma.aPIKey.findUnique = (async (args: { where: { hash: string } }) => {
    assert.equal(args.where.hash, tokenHash(token)); return stored;
  }) as unknown as typeof original;
  t.after(() => { prisma.aPIKey.findUnique = original; });
  const request = () => new Request("https://example.com/api/integrations/summary?householdId=household-b", { headers: { Authorization: `Bearer ${token}` } });
  await assert.rejects(requireIntegrationKey(new Request("https://example.com")), /required/);
  assert.equal((await requireIntegrationKey(request())).householdId, "household-a");
  stored = { ...stored, revokedAt: new Date() };
  await assert.rejects(requireIntegrationKey(request()), /revoked/);
  stored = { id: "key", scopes: ["write"], revokedAt: null };
  await assert.rejects(requireIntegrationKey(request()), /scope/);
  stored = null;
  await assert.rejects(requireIntegrationKey(request()), /Invalid/);
});
test("integration routes fail closed without credentials and never cache errors", async () => {
  const { GET: summary } = await import("../src/app/api/integrations/summary/route");
  const { GET: calendar } = await import("../src/app/api/integrations/calendar.ics/route");
  for (const handler of [summary, calendar]) {
    const response = await handler(new Request("https://example.com/api/integrations/summary?token=ignored"));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Authorization");
    assert.ok(response.headers.get("www-authenticate"));
  }
});
test("calendar service rejects malformed input before any database access", async () => {
  const { getCalendarRange } = await import("../src/lib/calendarService");
  await assert.rejects(getCalendarRange("household-a", "2026-02-30", "2026-03-01"), RangeError);
  await assert.rejects(getCalendarRange("household-a", "2026-01-01", "2028-01-01"), RangeError);
});
test("shared-day feed is all-day and DST-crossing nights retain their actual end", () => {
  const days = [day("2026-10-23"), day("2026-10-24"), day("2026-10-25", [parent("dad", "00:30", "06:00"), parent("mum")])];
  const ics = calendarICS(days, "Europe/London", new Date("2026-10-23T00:00:00Z"));
  assert.match(ics, /UID:together-2026-10-24@our-days/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261024\r\nDTEND;VALUE=DATE:20261025/);
  assert.match(ics, /DTSTART:20261024T233000Z\r\nDTEND:20261025T060000Z/);
});
