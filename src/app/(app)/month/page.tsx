"use client";

import { useCallback, useEffect, useState } from "react";
import { Brush, Check, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useCalendarChangedListener, emitCalendarChanged } from "@/lib/refresh";
import { PlanWeekSheet } from "@/components/PlanWeekSheet";
import { MemberAvatar } from "@/components/memberIcon";
import { resolveQuickShiftConfig } from "@/lib/quickShift";
import type { CalendarDayView, FamilyMember } from "@/lib/clientTypes";

type QuickFillAction = "DAY" | "NIGHT" | "OFF" | "HOLIDAY";

const ACTION_LABELS: Record<QuickFillAction, string> = {
  DAY: "Days",
  NIGHT: "Nights",
  OFF: "Off",
  HOLIDAY: "Holiday",
};

function toMinutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function shiftDurationMinutes(start: string, end: string): number {
  const s = toMinutesOfDay(start);
  let e = toMinutesOfDay(end);
  if (e <= s) e += 1440; // overnight
  return e - s;
}

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

function mondayOf(date: string): string {
  return addDays(date, -weekdayIndexMondayFirst(date));
}

// The Monday of each week that has any day inside this month.
function weekStartsForMonth(monthStart: string): string[] {
  const last = addDays(monthStart, daysInMonth(monthStart) - 1);
  const starts: string[] = [];
  let cursor = mondayOf(monthStart);
  while (cursor <= last) {
    starts.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return starts;
}

export default function MonthPage() {
  const [monthStart, setMonthStart] = useState(() => firstOfMonth(todayStr()));
  const [days, setDays] = useState<CalendarDayView[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPlan, setShowPlan] = useState(false);

  // --- Quick fill (paint) tool -------------------------------------------
  const [quickFillOn, setQuickFillOn] = useState(false);
  const [parents, setParents] = useState<FamilyMember[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<QuickFillAction | null>(null);
  const [pending, setPending] = useState<Map<string, { ownerId: string; action: QuickFillAction }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [quickFillError, setQuickFillError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ members: FamilyMember[] }>("/api/family-members").then((d) =>
      setParents(d.members.filter((m) => m.kind === "PARENT")),
    );
  }, []);

  function startQuickFill() {
    setQuickFillOn(true);
    setSelectedOwnerId(null);
    setSelectedAction(null);
    setPending(new Map());
    setQuickFillError(null);
  }

  function cancelQuickFill() {
    setQuickFillOn(false);
    setSelectedOwnerId(null);
    setSelectedAction(null);
    setPending(new Map());
    setQuickFillError(null);
  }

  function tapDate(date: string) {
    if (!quickFillOn || !selectedOwnerId || !selectedAction) return;
    setPending((prev) => {
      const next = new Map(prev);
      const existing = next.get(date);
      if (existing && existing.ownerId === selectedOwnerId && existing.action === selectedAction) {
        next.delete(date); // tapping the same date again undoes it
      } else {
        next.set(date, { ownerId: selectedOwnerId, action: selectedAction });
      }
      return next;
    });
  }

  function pendingColor(mark: { ownerId: string; action: QuickFillAction }): string {
    const member = parents.find((p) => p.id === mark.ownerId);
    if (mark.action === "OFF") return "var(--muted)";
    if (mark.action === "HOLIDAY") return "var(--family)";
    if (!member) return "var(--accent)";
    const cfg = resolveQuickShiftConfig(member);
    return mark.action === "NIGHT" ? cfg.nightColor : cfg.dayColor;
  }

  async function saveQuickFill() {
    setSaving(true);
    setQuickFillError(null);
    try {
      for (const [date, mark] of pending) {
        const member = parents.find((p) => p.id === mark.ownerId);
        if (!member) continue;
        const cfg = resolveQuickShiftConfig(member);
        let payload: Record<string, unknown> = { ownerId: mark.ownerId, date, shiftTypeId: null };
        if (mark.action === "DAY") {
          payload = { ...payload, customStart: cfg.dayStartLocal, customEnd: cfg.dayEndLocal, paidMinutes: shiftDurationMinutes(cfg.dayStartLocal, cfg.dayEndLocal) };
        } else if (mark.action === "NIGHT") {
          payload = { ...payload, customStart: cfg.nightStartLocal, customEnd: cfg.nightEndLocal, paidMinutes: shiftDurationMinutes(cfg.nightStartLocal, cfg.nightEndLocal) };
        } else if (mark.action === "HOLIDAY") {
          payload = { ...payload, customStart: null, customEnd: null, note: "Annual leave" };
        } else {
          payload = { ...payload, customStart: null, customEnd: null };
        }
        await apiFetch("/api/shifts", { method: "POST", body: JSON.stringify(payload) });
      }
      cancelQuickFill();
      emitCalendarChanged();
    } catch (err) {
      setQuickFillError(err instanceof Error ? err.message : "Couldn't save some of those changes");
    } finally {
      setSaving(false);
    }
  }
  // -------------------------------------------------------------------------

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

      <button
        className="btn btn-primary btn-block"
        onClick={() => setShowPlan(true)}
        style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
      >
        <Sparkles size={17} /> Plan the month — best shifts to request
      </button>

      {showPlan && (
        <PlanWeekSheet
          weekStarts={weekStartsForMonth(monthStart)}
          onClose={() => setShowPlan(false)}
          onApplied={() => emitCalendarChanged()}
        />
      )}

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
            const mark = pending.get(day.date);
            const canPaint = quickFillOn && Boolean(selectedOwnerId) && Boolean(selectedAction);
            return (
              <div
                key={day.date}
                className={`month-cell${day.bothParentsOff ? " together" : ""}${hasConflict ? " conflict" : ""}`}
                style={{
                  ...(isToday ? { outline: "2px solid var(--accent)" } : undefined),
                  ...(mark ? { boxShadow: `inset 0 0 0 3px ${pendingColor(mark)}` } : undefined),
                  ...(canPaint ? { cursor: "pointer" } : undefined),
                }}
                title={titleLines.join("\n")}
                onClick={canPaint ? () => tapDate(day.date) : undefined}
              >
                <span>{dayNum}</span>
                <div className="dot-row">
                  {day.members
                    .filter((m) => !m.isOff && m.memberKind === "PARENT")
                    .map((m) => (
                      <span
                        key={m.memberId}
                        className="dot"
                        style={{ background: m.displayColor ?? `var(--${m.colorToken})` }}
                      />
                    ))}
                </div>
                {mark && (
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      right: 3,
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: pendingColor(mark),
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "center" }}>
        Tap and hold a day to see who&apos;s doing what. Pink = both parents off · red dot = childcare needed.
      </p>

      {/* Quick-fill (paint) tool: pick a person, pick Days/Nights/Off/Holiday,
          then tap dates above to mark them - tap again to undo - then Save. */}
      {parents.length > 0 && (
        <div className="card" style={{ marginTop: 4 }}>
          {!quickFillOn ? (
            <button
              className="btn btn-secondary btn-block"
              onClick={startQuickFill}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
            >
              <Brush size={17} /> Quick fill — paint shifts straight onto the calendar
            </button>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <strong style={{ fontSize: 14 }}>Quick fill</strong>
                <button className="btn btn-ghost" aria-label="Close quick fill" style={{ padding: 6, minHeight: "auto" }} onClick={cancelQuickFill}>
                  <X size={18} />
                </button>
              </div>

              {quickFillError && <div className="error-banner">{quickFillError}</div>}

              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Who?</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                {parents.map((p) => (
                  <button
                    key={p.id}
                    className="choice-btn"
                    style={selectedOwnerId === p.id ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
                    onClick={() => setSelectedOwnerId(p.id)}
                  >
                    <MemberAvatar icon={p.icon} colorToken={p.colorToken} size={18} />
                    {p.name}
                  </button>
                ))}
              </div>

              {selectedOwnerId && (
                <>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>What?</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                    {(Object.keys(ACTION_LABELS) as QuickFillAction[]).map((action) => {
                      const member = parents.find((p) => p.id === selectedOwnerId)!;
                      const cfg = resolveQuickShiftConfig(member);
                      const swatch = action === "DAY" ? cfg.dayColor : action === "NIGHT" ? cfg.nightColor : action === "HOLIDAY" ? "var(--family)" : "var(--muted)";
                      const active = selectedAction === action;
                      return (
                        <button
                          key={action}
                          className="choice-btn"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            ...(active ? { borderColor: swatch, background: `${swatch}22`, color: swatch } : undefined),
                          }}
                          onClick={() => setSelectedAction(action)}
                        >
                          <span style={{ width: 10, height: 10, borderRadius: "50%", background: swatch, flexShrink: 0 }} />
                          {ACTION_LABELS[action]}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {selectedOwnerId && selectedAction && (
                <p style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 12 }}>
                  Tap dates above to mark them {ACTION_LABELS[selectedAction].toLowerCase()} — tap a marked date again to
                  undo it. {pending.size > 0 ? `${pending.size} marked. ` : ""}Nothing changes until you save.
                </p>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" onClick={cancelQuickFill}>Cancel</button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  disabled={saving || pending.size === 0}
                  onClick={saveQuickFill}
                >
                  <Check size={16} /> {saving ? "Saving…" : `Save${pending.size > 0 ? ` ${pending.size}` : ""}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
