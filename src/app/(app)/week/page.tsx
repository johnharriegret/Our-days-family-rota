"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, Heart, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useBackgroundRefresh, useCalendarChangedListener, emitCalendarChanged } from "@/lib/refresh";
import { MemberAvatar } from "@/components/memberIcon";
import { ChildcareBanner } from "@/components/ChildcareBanner";
import { PlanWeekSheet } from "@/components/PlanWeekSheet";
import { DEFAULT_TOGETHER_COLOR } from "@/lib/constants";
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
  const [togetherColor, setTogetherColor] = useState(DEFAULT_TOGETHER_COLOR);

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
  useBackgroundRefresh(load);

  useEffect(() => {
    apiFetch<{ togetherColor: string }>("/api/settings/appearance").then((d) => setTogetherColor(d.togetherColor));
  }, []);

  const togetherThisWeek = days.filter((day) => day.bothParentsOff).length;

  return (
    <div className="page-body">
      <section className="month-hero compact">
        <div className="month-hero-copy">
          <span className="month-eyebrow"><CalendarRange size={14} /> This week</span>
          <h1>{dayLabel(weekStart).day} – {dayLabel(addDays(weekStart, 6)).day}</h1>
          <p>{togetherThisWeek} day{togetherThisWeek === 1 ? "" : "s"} off together this week</p>
        </div>
        <div className="month-switcher" aria-label="Choose week">
          <button onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Previous week"><ChevronLeft size={20} /></button>
          <button className="today-jump" onClick={() => setWeekStart(mondayOf(todayStr()))}>This week</button>
          <button onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Next week"><ChevronRight size={20} /></button>
        </div>
      </section>

      <div className="calendar-actions single">
        <button className="calendar-action primary" onClick={() => setShowPlan(true)}>
          <Sparkles size={17} /><span><strong>Plan the week</strong><small>Best shifts to request</small></span>
        </button>
      </div>

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
            <div className={`card week-day-card${isToday ? " today" : ""}`} key={day.date}>
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
                <div
                  className="together-badge"
                  style={{ marginTop: 8, color: togetherColor, background: `${togetherColor}22` }}
                >
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
