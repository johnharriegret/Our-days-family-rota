"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Brush, Check, ChevronLeft, ChevronRight, Sparkles, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useCalendarChangedListener, emitCalendarChanged } from "@/lib/refresh";
import { PlanWeekSheet } from "@/components/PlanWeekSheet";
import { MemberAvatar } from "@/components/memberIcon";
import { resolveQuickShiftConfig } from "@/lib/quickShift";
import { DEFAULT_TOGETHER_COLOR } from "@/lib/constants";
import { initials } from "@/lib/initials";
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

// Every week's Monday for the 12 months starting from this one.
function weekStartsForYear(monthStart: string): string[] {
  const last = addDays(addMonths(monthStart, 12), -1);
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
  // null = closed; otherwise which scope of plan is open.
  const [planScope, setPlanScope] = useState<"month" | "year" | null>(null);
  // Stable across re-renders (e.g. the calendar refreshing after a plan is
  // applied) so PlanWeekSheet's own data-fetch effect doesn't re-fire and
  // flash the whole sheet back to "Working out the best fit..." - it should
  // only recompute when the viewed month (or, for a year plan, its start)
  // actually changes.
  const weekStarts = useMemo(() => weekStartsForMonth(monthStart), [monthStart]);
  const yearWeekStarts = useMemo(() => weekStartsForYear(monthStart), [monthStart]);

  // --- Quick fill (paint) tool -------------------------------------------
  const [quickFillOn, setQuickFillOn] = useState(false);
  const [parents, setParents] = useState<FamilyMember[]>([]);
  const [togetherColor, setTogetherColor] = useState(DEFAULT_TOGETHER_COLOR);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<QuickFillAction | null>(null);
  const [pending, setPending] = useState<Map<string, { ownerId: string; action: QuickFillAction }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [quickFillError, setQuickFillError] = useState<string | null>(null);
  const [editingDay, setEditingDay] = useState<CalendarDayView | null>(null);
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ members: FamilyMember[] }>("/api/family-members").then((d) =>
      setParents(d.members.filter((m) => m.kind === "PARENT")),
    );
    apiFetch<{ togetherColor: string }>("/api/settings/appearance").then((d) => setTogetherColor(d.togetherColor));
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

  async function deleteSavedShift(shiftId: string) {
    if (!confirm("Remove this saved shift? You can then paint a new one or let the optimiser suggest a replacement.")) return;
    setDeletingShiftId(shiftId);
    try {
      await apiFetch(`/api/shifts/${shiftId}`, { method: "DELETE" });
      setEditingDay(null);
      emitCalendarChanged();
    } catch (err) {
      setQuickFillError(err instanceof Error ? err.message : "Couldn't remove that shift");
    } finally {
      setDeletingShiftId(null);
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

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
          onClick={() => setPlanScope("month")}
        >
          <Sparkles size={17} /> Plan the month
        </button>
        <button
          className="btn btn-secondary"
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
          onClick={() => setPlanScope("year")}
        >
          <Sparkles size={17} /> Plan the year
        </button>
      </div>

      {planScope && (
        <PlanWeekSheet
          weekStarts={planScope === "year" ? yearWeekStarts : weekStarts}
          onClose={() => setPlanScope(null)}
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
            const children = day.members.filter((m) => m.memberKind === "CHILD");
            const schoolBadge = children.length === 0
              ? null
              : children.every((child) => child.label.startsWith("School"))
                ? "School"
                : children.map((child) => child.label.replace(/^Home ·?\s*/, "")).find(Boolean) ?? "Home";
            return (
              <div
                key={day.date}
                className={`month-cell${hasConflict ? " conflict" : ""}`}
                style={{
                  ...(day.bothParentsOff && !hasConflict ? { background: `${togetherColor}33` } : undefined),
                  ...(isToday ? { outline: "2px solid var(--accent)" } : undefined),
                  ...(mark ? { boxShadow: `inset 0 0 0 3px ${pendingColor(mark)}` } : undefined),
                  ...(canPaint ? { cursor: "pointer" } : undefined),
                }}
                title={titleLines.join("\n")}
                onClick={canPaint ? () => tapDate(day.date) : () => setEditingDay(day)}
              >
                <span className="month-cell-daynum">{dayNum}</span>
                <div className="shift-pills">
                  {day.members
                    .filter((m) => !m.isOff && m.memberKind === "PARENT")
                    .map((m) => (
                      <span
                        key={m.memberId}
                        className="shift-pill"
                        style={{ background: m.displayColor ?? `var(--${m.colorToken})` }}
                      >
                        {initials(m.name)}
                      </span>
                    ))}
                </div>
                {schoolBadge && <span className={`school-badge${schoolBadge === "School" ? " at-school" : ""}`}>{schoolBadge}</span>}
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
      <p style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 4 }}>
        <span>Tap a day to see who&apos;s doing what or remove a saved shift.</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: togetherColor, display: "inline-block", flexShrink: 0 }} />
          = both parents off
        </span>
        <span>· red dot = childcare needed.</span>
      </p>

      {editingDay && (
        <div className="card" style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong>{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${editingDay.date}T12:00:00Z`))}</strong>
            <button className="btn btn-ghost" onClick={() => setEditingDay(null)} aria-label="Close day editor" style={{ padding: 6, minHeight: "auto" }}><X size={18} /></button>
          </div>
          {editingDay.members.filter((member) => member.memberKind === "PARENT").map((member) => {
            const shiftId = member.shiftId;
            return <div className="row" key={member.memberId}>
              <div style={{ flex: 1 }}>
                <div className="row-title">{member.name} · {member.label}</div>
                <div className="row-sub">{member.source === "PATTERN" ? "Repeating rota — edit the pattern in Settings" : member.shiftId ? "Saved shift — safe to remove" : "No saved shift"}</div>
              </div>
              {shiftId && !member.locked && (
                <button className="btn btn-ghost" disabled={deletingShiftId === shiftId} onClick={() => deleteSavedShift(shiftId)} aria-label={`Remove ${member.name}'s saved shift`} style={{ color: "var(--bad)", padding: 8, minHeight: "auto" }}>
                  <Trash2 size={17} />
                </button>
              )}
            </div>;
          })}
          {editingDay.members.filter((member) => member.memberKind === "CHILD").map((member) => <div className="row-sub" key={member.memberId}>{member.name}: {member.label}</div>)}
        </div>
      )}

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
