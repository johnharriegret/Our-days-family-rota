"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Brush, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, GraduationCap, Heart, Sparkles, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { useCalendarChangedListener, emitCalendarChanged } from "@/lib/refresh";
import { PlanWeekSheet } from "@/components/PlanWeekSheet";
import { MemberAvatar } from "@/components/memberIcon";
import { resolveQuickShiftConfig } from "@/lib/quickShift";
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

function parentSlot(name: string): 0 | 1 {
  // Jeanicar is deliberately lane two. The other household parent occupies
  // lane one even if their display name changes, so the calendar never jumps.
  return /jean|^jg$/i.test(name) || initials(name) === "JG" ? 1 : 0;
}

function childMarkerColor(name: string, fallback: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("clark")) return "#176b4d";
  if (lower.includes("thea")) return "#a63d45";
  return `var(--${fallback})`;
}

function childMarkerStyle(name: string, fallback: string): CSSProperties {
  return { "--marker-color": childMarkerColor(name, fallback) } as CSSProperties;
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
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<QuickFillAction | null>(null);
  const [pending, setPending] = useState<Map<string, { ownerId: string; action: QuickFillAction }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [quickFillError, setQuickFillError] = useState<string | null>(null);
  const [editingDay, setEditingDay] = useState<CalendarDayView | null>(null);
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null);
  const [clearingMonth, setClearingMonth] = useState(false);

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

  async function deleteSavedShift(shiftId: string) {
    if (!confirm("Remove this saved shift? You can then paint a new one or let the optimiser suggest a replacement.")) return;
    setDeletingShiftId(shiftId);
    try {
      await apiFetch(`/api/shifts/${shiftId}`, { method: "DELETE" });
      emitCalendarChanged();
    } catch (err) {
      setQuickFillError(err instanceof Error ? err.message : "Couldn't remove that shift");
    } finally {
      setDeletingShiftId(null);
    }
  }

  async function clearWifeMonth() {
    const wife = parents.find((parent) => /jean/i.test(parent.name) || parent.icon === "mum");
    if (!wife) return;
    const last = daysInMonth(monthStart);
    const to = addDays(monthStart, last - 1);
    if (!confirm(`Clear ${wife.name}'s editable shifts from ${monthLabel}? Her repeating rota and any locked shifts will stay untouched.`)) return;
    setClearingMonth(true);
    try {
      await apiFetch("/api/shifts/clear", { method: "POST", body: JSON.stringify({ ownerId: wife.id, from: monthStart, to }) });
      emitCalendarChanged();
    } catch (err) {
      setQuickFillError(err instanceof Error ? err.message : "Couldn't clear that month");
    } finally {
      setClearingMonth(false);
    }
  }
  // -------------------------------------------------------------------------

  const load = useCallback(async () => {
    const last = daysInMonth(monthStart);
    const to = addDays(monthStart, last - 1);
    const data = await apiFetch<{ days: CalendarDayView[] }>(`/api/calendar?from=${monthStart}&to=${to}`);
    setDays(data.days);
    setEditingDay((current) =>
      data.days.find((day) => day.date === current?.date)
      ?? data.days.find((day) => day.date === todayStr())
      ?? data.days[0]
      ?? null,
    );
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
  const monthChildren = days[0]?.members.filter((member) => member.memberKind === "CHILD") ?? [];
  const conflictCount = days.filter((day) => day.childcare?.status === "CHILDCARE_NEEDED").length;
  const togetherCount = days.filter((day) => day.bothParentsOff).length;

  function goToToday() {
    const today = todayStr();
    setMonthStart(firstOfMonth(today));
    setEditingDay(days.find((day) => day.date === today) ?? null);
  }

  return (
    <div className="page-body month-page">
      <section className="month-hero">
        <div className="month-hero-copy">
          <span className="month-eyebrow"><CalendarDays size={14} /> Family command centre</span>
          <h1>{monthLabel}</h1>
          <p>{conflictCount > 0 ? `${conflictCount} day${conflictCount === 1 ? "" : "s"} need a childcare check` : "Childcare cover looks clear"} · {togetherCount} days off together</p>
        </div>
        <div className="month-switcher" aria-label="Choose month">
          <button onClick={() => setMonthStart((m) => addMonths(m, -1))} aria-label="Previous month"><ChevronLeft size={20} /></button>
          <button className="today-jump" onClick={goToToday}>Today</button>
          <button onClick={() => setMonthStart((m) => addMonths(m, 1))} aria-label="Next month"><ChevronRight size={20} /></button>
        </div>
      </section>

      <div className="calendar-actions">
        <button className="calendar-action primary" onClick={() => setPlanScope("month")}><Sparkles size={17} /><span><strong>Plan month</strong><small>Suggest Jeanicar&apos;s shifts</small></span></button>
        <button className="calendar-action" onClick={quickFillOn ? cancelQuickFill : startQuickFill}><Brush size={17} /><span><strong>{quickFillOn ? "Close quick fill" : "Quick fill"}</strong><small>Paint shifts onto dates</small></span></button>
        <button className="calendar-action compact" onClick={() => setPlanScope("year")}><Sparkles size={16} /><span><strong>Plan year</strong></span></button>
        {parents.some((parent) => /jean/i.test(parent.name) || parent.icon === "mum") && (
          <button className="calendar-action compact danger" disabled={clearingMonth} onClick={clearWifeMonth}><Trash2 size={16} /><span><strong>{clearingMonth ? "Clearing…" : "Clear month"}</strong></span></button>
        )}
      </div>

      {planScope && (
        <PlanWeekSheet
          weekStarts={planScope === "year" ? yearWeekStarts : weekStarts}
          onClose={() => setPlanScope(null)}
          onApplied={() => emitCalendarChanged()}
        />
      )}

      {quickFillOn && parents.length > 0 && (
        <div className="card quick-fill-panel">
          <div className="quick-fill-heading"><div><strong>Quick fill</strong><span>Choose who and what, then tap every date you want to paint.</span></div><button className="icon-button" aria-label="Close quick fill" onClick={cancelQuickFill}><X size={18} /></button></div>
          {quickFillError && <div className="error-banner">{quickFillError}</div>}
          <div className="quick-fill-controls">
            <div><span className="control-label">Who?</span><div className="choice-row">{parents.map((p) => <button key={p.id} className={`choice-chip${selectedOwnerId === p.id ? " selected" : ""}`} onClick={() => setSelectedOwnerId(p.id)}><MemberAvatar icon={p.icon} colorToken={p.colorToken} size={18} />{p.name}</button>)}</div></div>
            {selectedOwnerId && <div><span className="control-label">What?</span><div className="choice-row">{(Object.keys(ACTION_LABELS) as QuickFillAction[]).map((action) => {
              const member = parents.find((p) => p.id === selectedOwnerId)!;
              const cfg = resolveQuickShiftConfig(member);
              const swatch = action === "DAY" ? cfg.dayColor : action === "NIGHT" ? cfg.nightColor : action === "HOLIDAY" ? "var(--family)" : "var(--muted)";
              return <button key={action} className={`choice-chip${selectedAction === action ? " selected" : ""}`} style={{ "--choice-color": swatch } as CSSProperties} onClick={() => setSelectedAction(action)}><i style={{ background: swatch }} />{ACTION_LABELS[action]}</button>;
            })}</div></div>}
          </div>
          <div className="quick-fill-footer"><span>{selectedOwnerId && selectedAction ? `${pending.size || "No"} date${pending.size === 1 ? "" : "s"} marked` : "Pick a person and shift type to begin"}</span><button className="btn btn-primary" disabled={saving || pending.size === 0} onClick={saveQuickFill}><Check size={16} />{saving ? "Saving…" : `Save${pending.size ? ` ${pending.size}` : ""}`}</button></div>
        </div>
      )}

      {loading && <div className="empty-state">Building your month…</div>}

      <div className="calendar-workspace">
      <section className="calendar-card">
        <div className="calendar-card-head">
          <div><strong>At a glance</strong><span>Solid = school · ring = home</span></div>
          <div className="calendar-legend">
            {monthChildren.map((child) => <span key={child.memberId}><i className="legend-dot" style={childMarkerStyle(child.name, child.colorToken)} />{child.name.split(" ")[0]}</span>)}
          </div>
        </div>
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
            const parentRows = day.members.filter((member) => member.memberKind === "PARENT").sort((a, b) => parentSlot(a.name) - parentSlot(b.name));
            const children = day.members.filter((member) => member.memberKind === "CHILD");
            const holidaySlots = new Set(parentRows.filter((parent) => parent.label === "Annual leave").map((parent) => parentSlot(parent.name)));
            const holidayClass = holidaySlots.size === 2 ? " holiday-both" : holidaySlots.has(0) ? " holiday-hg" : holidaySlots.has(1) ? " holiday-jg" : "";
            const hasBankHoliday = children.some((child) => /bank holiday/i.test(child.label));
            const insetChildren = children.filter((child) => /inset/i.test(child.label));
            return (
              <button
                type="button"
                key={day.date}
                className={`month-cell${hasConflict ? " conflict" : ""}${holidayClass}${isToday ? " today" : ""}${editingDay?.date === day.date ? " selected" : ""}`}
                style={{
                  ...(mark ? { boxShadow: `inset 0 0 0 3px ${pendingColor(mark)}` } : undefined),
                }}
                title={titleLines.join("\n")}
                aria-pressed={editingDay?.date === day.date}
                onClick={canPaint ? () => tapDate(day.date) : () => setEditingDay(day)}
              >
                <span className="month-cell-daynum">{dayNum}</span>
                <div className="parent-lanes">
                  {[0, 1].map((slot) => {
                    const parent = parentRows.find((member) => parentSlot(member.name) === slot);
                    return parent && !parent.isOff ? <span key={parent.memberId} className="shift-pill" style={{ background: parent.displayColor ?? `var(--${parent.colorToken})` }}>
                      {initials(parent.name)}
                    </span> : <span className="parent-lane-empty" key={slot} />;
                  })}
                </div>
                <div className="child-marker-row" aria-label="School status">
                  {children.map((child) => <span key={child.memberId} className={`child-school-dot${child.label.startsWith("School") ? " at-school" : " home"}`} style={childMarkerStyle(child.name, child.colorToken)} title={`${child.name}: ${child.label}`} />)}
                </div>
                <div className="exception-marker-row" aria-label="School exceptions">
                  {hasBankHoliday && <span className="exception-marker bank" title="Bank holiday">BH</span>}
                  {insetChildren.map((child) => <span key={child.memberId} className="exception-marker inset" title={`${child.name}: INSET day`} style={{ background: childMarkerColor(child.name, child.colorToken) }}>IN</span>)}
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
              </button>
            );
          })}
        </div>
        <div className="calendar-footnote"><span><i className="conflict-key" /> Childcare check</span><span><i className="holiday-key" /> Annual leave</span><span>Tap a date for the full day</span></div>
      </section>

      {editingDay && (
        <aside className="day-inspector">
          <div className="day-inspector-head">
            <span>{new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(new Date(`${editingDay.date}T12:00:00Z`))}</span>
            <strong>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(new Date(`${editingDay.date}T12:00:00Z`))}</strong>
            {editingDay.bothParentsOff && <div className="together-callout"><Heart size={14} /> Day off together</div>}
          </div>
          {editingDay.childcare?.status === "CHILDCARE_NEEDED" && <div className="day-warning">{editingDay.childcare.explanation}</div>}
          <div className="inspector-section"><div className="inspector-title"><Clock3 size={15} /> Parents</div>
          {editingDay.members.filter((member) => member.memberKind === "PARENT").map((member) => {
            const shiftId = member.shiftId;
            return <div className="inspector-row" key={member.memberId}>
              <MemberAvatar icon={member.icon} colorToken={member.colorToken} size={34} />
              <div className="inspector-row-copy">
                <div className="row-title">{member.name}</div>
                <div className="shift-detail">{member.label}</div>
                <div className="row-sub">{member.source === "PATTERN" ? "Repeating rota — edit the pattern in Settings" : member.shiftId ? "Saved shift — safe to remove" : "No saved shift"}</div>
              </div>
              {shiftId && !member.locked && (
                <button className="btn btn-ghost" disabled={deletingShiftId === shiftId} onClick={() => deleteSavedShift(shiftId)} aria-label={`Remove ${member.name}'s saved shift`} style={{ color: "var(--bad)", padding: 8, minHeight: "auto" }}>
                  <Trash2 size={17} />
                </button>
              )}
            </div>;
          })}
          </div>
          <div className="inspector-section"><div className="inspector-title"><GraduationCap size={16} /> Children</div>
          {editingDay.members.filter((member) => member.memberKind === "CHILD").map((member) => <div className="child-detail" key={member.memberId}><i className={`child-school-dot${member.label.startsWith("School") ? " at-school" : " home"}`} style={childMarkerStyle(member.name, member.colorToken)} /><span><strong>{member.name.split(" ")[0]}</strong><small>{member.label}</small></span></div>)}
          </div>
          {editingDay.events.length > 0 && (
            <div className="inspector-section">
              <div className="inspector-title"><CalendarDays size={15} /> Appointments &amp; activities</div>
              {editingDay.events.map((event) => <div className="event-detail" key={event.id}><strong>{event.startLocal ?? "All day"}</strong><span>{event.title}</span></div>)}
            </div>
          )}
        </aside>
      )}
      </div>

    </div>
  );
}
