"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useCalendarChangedListener, emitCalendarChanged } from "@/lib/refresh";
import { MemberAvatar } from "@/components/memberIcon";
import { ChildcareBanner } from "@/components/ChildcareBanner";
import { PlanWeekSheet } from "@/components/PlanWeekSheet";
import type { CalendarDayView } from "@/lib/clientTypes";

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  return addDays(date, -diff);
}

function dayLabel(date: string): { weekday: string; day: string } {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(d),
    day: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d),
  };
}

export default function WeekPage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayStr()));
  const [days, setDays] = useState<CalendarDayView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const to = addDays(weekStart, 6);
      const data = await apiFetch<{ days: CalendarDayView[] }>(`/api/calendar?from=${weekStart}&to=${to}`);
      setDays(data.days);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the week");
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    load();
  }, [load]);
  useCalendarChangedListener(load);

  return (
    <div className="page-body">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button className="btn btn-ghost" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Previous week">
          <ChevronLeft size={22} />
        </button>
        <strong>{dayLabel(weekStart).day} {"–"} {dayLabel(addDays(weekStart, 6)).day}</strong>
        <button className="btn btn-ghost" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Next week">
          <ChevronRight size={22} />
        </button>
      </div>

      <button
        className="btn btn-primary btn-block"
        onClick={() => setShowPlan(true)}
        style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
      >
        <Sparkles size={17} /> Plan the week — best shifts to request
      </button>

      {showPlan && (
        <PlanWeekSheet
          weekStarts={[weekStart]}
          onClose={() => setShowPlan(false)}
          onApplied={() => emitCalendarChanged()}
        />
      )}

      {loading && <div className="empty-state">Loading…</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="week-grid">
        {days.map((day) => {
          const { weekday, day: dayNum } = dayLabel(day.date);
          const isToday = day.date === todayStr();
          return (
            <div className="card week-day-card" key={day.date} style={isToday ? { outline: "2px solid var(--accent)" } : undefined}>
              <div className="week-day-header">
                <span className="week-day-name">{weekday}</span>
                <span className="week-day-date">{dayNum}</span>
              </div>
              {day.members.map((m) => (
                <div className="row" key={m.memberId}>
                  <MemberAvatar icon={m.icon} colorToken={m.colorToken} size={16} color={m.displayColor} />
                  <div>
                    <div className="row-title" style={{ fontSize: 14 }}>{m.name}</div>
                    <div className="row-sub">{m.label}</div>
                  </div>
                </div>
              ))}
              {day.events.map((e) => (
                <div className="row" key={e.id}>
                  <div className="avatar member-family" style={{ width: 32, height: 32 }}>📌</div>
                  <div className="row-title" style={{ fontSize: 14 }}>{e.title}</div>
                </div>
              ))}
              {day.bothParentsOff && (
                <div className="together-badge" style={{ marginTop: 8 }}>
                  <Heart size={13} /> Both off
                </div>
              )}
              <ChildcareBanner childcare={day.childcare} compact />
            </div>
          );
        })}
      </div>
    </div>
  );
}
