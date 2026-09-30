import { addDays, dayDiff, dayOfWeek } from "../engine/dates";
import { localDateTimeToUtc, shiftToUtcInterval } from "../engine/intervals";
import type { CalendarDayView } from "../clientTypes";

export function validateCalendarRange(from: string, to: string, maximum = 93): void {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2200 &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || to < from || dayDiff(to, from) >= maximum) {
    throw new RangeError(`Use real YYYY-MM-DD dates, ordered from/to, up to ${maximum} days`);
  }
}
export function weekStart(today: string, startsOn: number): string {
  return addDays(today, -((dayOfWeek(today) - startsOn + 7) % 7));
}
/** No shift starts today AND no previous overnight shift is still running. */
export function fullDayOff(day: CalendarDayView, previous?: CalendarDayView): boolean {
  const parents = day.members.filter(m => m.memberKind === "PARENT");
  return parents.length >= 2 && parents.every(m => m.isOff && m.source !== "NONE" &&
    previous?.members.some(p => p.memberId === m.memberId && p.source !== "NONE" &&
      (p.isOff || (p.startLocal && p.endLocal &&
        (p.endLocal > p.startLocal || p.endLocal === "00:00")))));
}
export function buildSummary(days: CalendarDayView[], today: string, timezone: string, startsOn: number, now = new Date()) {
  const start = weekStart(today, startsOn);
  const end = addDays(start, 6);
  const annotated = days.map((day, i) => ({ ...day, fullDayOffTogether: fullDayOff(day, days[i - 1]) }));
  const week = annotated.filter(d => d.date >= start && d.date <= end);
  const upcoming = annotated.flatMap(d => d.events.map(event => ({ ...event, date: d.date,
    startsAt: event.startLocal ? localDateTimeToUtc(d.date, event.startLocal, timezone).toISOString() : null,
  }))).filter(e => e.date >= today && (!e.startsAt || Date.parse(e.startsAt) >= now.getTime()))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startLocal ?? "").localeCompare(b.startLocal ?? "") || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1, generatedAt: now.toISOString(), timezone, today,
    week: { from: start, to: end, days: week,
      rotaDaysOffTogether: week.filter(d => d.members.filter(m => m.memberKind === "PARENT").length >= 2 && d.bothParentsOff).map(d => d.date),
      fullDaysOffTogether: week.filter(d => d.fullDayOffTogether).map(d => d.date),
    },
    nextFullDayOffTogether: annotated.find(d => d.date >= today && d.fullDayOffTogether)?.date ?? null,
    upcomingEvents: upcoming.slice(0, 50), nextAppointment: upcoming.find(e => e.category === "APPOINTMENT") ?? null,
    childcareConflicts: annotated.filter(d => d.date >= today && d.childcare?.status === "CHILDCARE_NEEDED").map(d => ({ date: d.date, ...d.childcare })),
    coverage: { from: days[0]?.date, to: days.at(-1)?.date },
    note: "Blank days for a parent with shift types are assumed off, matching Our Days. Full days exclude overnight carryover; post-night sleep is not inferred. Events are saved one-off entries; recurrence is not supported.",
  };
}
function escapeICS(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
function stamp(date: Date): string { return date.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"; }
/** RFC 5545 folds at 75 UTF-8 octets without splitting Unicode characters. */
function fold(line: string): string {
  let result = "", bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > 75) { result += "\r\n "; bytes = 1; }
    result += ch; bytes += size;
  }
  return result;
}
export function calendarICS(days: CalendarDayView[], timezone: string, now = new Date(), kind = "all"): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Our Days//Family Calendar//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Our Days"];
  function event(uid: string, title: string, date: string, start: string | null, end: string | null, description?: string) {
    lines.push("BEGIN:VEVENT", `UID:${escapeICS(uid)}@our-days`, `DTSTAMP:${stamp(now)}`, `SUMMARY:${escapeICS(title)}`);
    if (start) {
      const interval = shiftToUtcInterval(date, { startLocal: start, endLocal: end ?? start }, timezone)!;
      lines.push(`DTSTART:${stamp(interval.start)}`,
        `DTEND:${stamp(end ? interval.end : new Date(interval.start.getTime() + 3_600_000))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${date.replaceAll("-", "")}`, `DTEND;VALUE=DATE:${addDays(date, 1).replaceAll("-", "")}`);
    }
    if (description) lines.push(`DESCRIPTION:${escapeICS(description)}`);
    lines.push("END:VEVENT");
  }
  days.forEach((day, i) => {
    if (i > 0 && (kind === "all" || kind === "events")) day.events.forEach(e => event(`event-${e.id}-${day.date}`, e.title, day.date, e.startLocal, e.endLocal, e.category));
    if (i > 0 && (kind === "all" || kind === "shifts")) day.members.filter(m => m.memberKind === "PARENT" && !m.isOff).forEach(m => event(`shift-${m.memberId}-${day.date}`, `${m.name}: ${m.label}`, day.date, m.startLocal, m.endLocal));
    if (i > 0 && (kind === "all" || kind === "together") && fullDayOff(day, days[i - 1])) event(`together-${day.date}`, "Full day off together", day.date, null, null, "No working shift overlaps this day. Post-night sleep is not inferred.");
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
