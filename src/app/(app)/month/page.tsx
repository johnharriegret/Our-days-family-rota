"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useCalendarChangedListener } from "@/lib/refresh";
import type { CalendarDayView } from "@/lib/clientTypes";

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${String(newM).padStart(2, "0")}-01`;
}

function daysInMonth(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function weekdayIndexMondayFirst(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export default function MonthPage() {
  const [monthStart, setMonthStart] = useState(() => firstOfMonth(todayStr()));
  const [days, setDays] = useState<CalendarDayView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const last = daysInMonth(monthStart);
    const to = addDays(monthStart, last - 1);
    const data = await apiFetch<{ days: CalendarDayView[] }>(`/api/calendar?from=${monthStart}&to=${to}`);
    setDays(data.days);
    setLoading(false);
  }, [monthStart]);

  useEffect(() => {
    load();
  }, [load]);
  useCalendarChangedListener(load);

  const leadingBlanks = weekdayIndexMondayFirst(monthStart);
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(`${monthStart}T12:00:00Z`),
  );

  return (
    <div className="page-body">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button className="btn btn-ghost" onClick={() => setMonthStart((m) => addMonths(m, -1))} aria-label="Previous month">
          <ChevronLeft size={22} />
        </button>
        <strong>{monthLabel}</strong>
        <button className="btn btn-ghost" onClick={() => setMonthStart((m) => addMonths(m, 1))} aria-label="Next month">
          <ChevronRight size={22} />
        </button>
      </div>

      {loading && <div className="empty-state">Loading…</div>}

      <div className="card">
        <div className="month-grid" style={{ marginBottom: 6 }}>
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
              {d}
            </div>
          ))}
        </div>
        <div className="month-grid">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {days.map((day) => {
            const dayNum = Number(day.date.slice(8, 10));
            const isToday = day.date === todayStr();
            const hasConflict = day.childcare?.status === "CHILDCARE_NEEDED";
            const titleLines = day.members.map((m) => `${m.name}: ${m.label}`);
            if (hasConflict && day.childcare) titleLines.push(`⚠ ${day.childcare.explanation}`);
            return (
              <div
                key={day.date}
                className={`month-cell${day.bothParentsOff ? " together" : ""}${hasConflict ? " conflict" : ""}`}
                style={isToday ? { outline: "2px solid var(--accent)" } : undefined}
                title={titleLines.join("\n")}
              >
                <span>{dayNum}</span>
                <div className="dot-row">
                  {day.members
                    .filter((m) => !m.isOff && m.memberKind === "PARENT")
                    .map((m) => (
                      <span
                        key={m.memberId}
                        className="dot"
                        style={{ background: `var(--${m.colorToken})` }}
                      />
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "center" }}>
        Tap and hold a day to see who&apos;s doing what. Pink = both parents off · red dot = childcare needed.
      </p>
    </div>
  );
}
