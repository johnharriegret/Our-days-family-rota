"use client";

import { useCallback, useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useCalendarChangedListener } from "@/lib/refresh";
import { MemberAvatar } from "@/components/memberIcon";
import { ChildcareBanner } from "@/components/ChildcareBanner";
import type { CalendarDayView } from "@/lib/clientTypes";

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function friendlyDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export default function TodayPage() {
  const [today, setToday] = useState<CalendarDayView | null>(null);
  const [nextTogether, setNextTogether] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const date = todayStr();
      const [calendar, next] = await Promise.all([
        apiFetch<{ days: CalendarDayView[] }>(`/api/calendar?from=${date}&to=${date}`),
        apiFetch<{ date: string | null }>(`/api/insights/next-day-off-together?from=${date}`),
      ]);
      setToday(calendar.days[0] ?? null);
      setNextTogether(next.date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load today");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useCalendarChangedListener(load);

  if (loading) return <div className="page-body empty-state">Loading…</div>;
  if (error) return <div className="page-body"><div className="error-banner">{error}</div></div>;
  if (!today) return null;

  const needsSetup = today.members.some((m) => m.source === "NONE");

  return (
    <div className="page-body">
      {needsSetup && (
        <div className="setup-banner">
          Finish setting up your family so the calendar and childcare checks work — add everyone&apos;s
          shifts in <a href="/settings">Settings</a>.
        </div>
      )}

      <div className="card">
        <h2>Today · {friendlyDate(today.date)}</h2>
        {today.members.map((m) => (
          <div className="row" key={m.memberId}>
            <MemberAvatar icon={m.icon} colorToken={m.colorToken} color={m.displayColor} />
            <div>
              <div className="row-title">{m.name}</div>
              <div className="row-sub">{m.label}</div>
            </div>
          </div>
        ))}
        {today.bothParentsOff && (
          <div className="pill pill-good" style={{ marginTop: 10 }}>
            <Heart size={13} /> Both off today
          </div>
        )}
        <ChildcareBanner childcare={today.childcare} />
      </div>

      {nextTogether && (
        <div className="card">
          <h2>Next day off together</h2>
          <div className="row" style={{ borderTop: "none", paddingTop: 0 }}>
            <div className="avatar member-family">
              <Heart size={18} />
            </div>
            <div>
              <div className="row-title">{friendlyDate(nextTogether)}</div>
              <div className="row-sub">Mark it in the diary</div>
            </div>
          </div>
        </div>
      )}

      {today.events.length > 0 && (
        <div className="card">
          <h2>Today&apos;s events</h2>
          {today.events.map((e) => (
            <div className="row" key={e.id}>
              <div className="avatar member-family">📌</div>
              <div>
                <div className="row-title">{e.title}</div>
                {e.startLocal && <div className="row-sub">{e.startLocal}{e.endLocal ? `–${e.endLocal}` : ""}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
