"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Lock, Sparkles, X } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { initials } from "@/lib/initials";
import { classifyShiftKind } from "@/lib/quickShift";
import type { CalendarDayView, ShiftType } from "@/lib/clientTypes";

type PlanOption = { id: string; name: string; startLocal: string; endLocal: string; paidMinutes: number };
type ShiftInterval = { startLocal: string; endLocal: string };
type PlanDay = {
  date: string;
  option: PlanOption | null;
  locked: boolean;
  lockedLabel: string | null;
  /** the other parent's own, already-fixed shift that day - not being planned here. */
  dadKnown: boolean;
  dadShift: ShiftInterval | null;
};
type PlanMetrics = {
  totalPaidMinutes: number;
  requiredMinutes: number;
  hoursExact: boolean;
  childcareConflicts: number;
  handoverDays: number;
  bothParentsWorkingDays: number;
  familyDaysTogether: number;
  coupleDaytimeOff: number;
};
/** One stretch with nobody available, as the server explained it. */
type PlanConflict = {
  startDate: string;
  startLocal: string;
  endDate: string;
  endLocal: string;
  elapsedMinutes: number;
  crossesMidnight: boolean;
  explanation: string;
};
type WeekPlan = { days: PlanDay[]; metrics: PlanMetrics; conflicts: PlanConflict[] };
type PlanDiagnostics = { exhaustive: boolean; truncated: boolean; generated: number; safe: number };
type PlanResponse = {
  best: WeekPlan | null;
  alternatives: WeekPlan[];
  /** the closest plan when every option has a childcare conflict - never a safe suggestion. */
  bestWithConflicts: WeekPlan | null;
  message?: string;
  diagnostics: PlanDiagnostics;
  ownerId: string;
  ownerName: string;
  otherParentName: string | null;
  weekStart: string;
  requiredMinutes: number | null;
};
type ReviewDraft = { plan: WeekPlan; weekStart: string; allowConflicts: boolean };

function hours(mins: number): string {
  return (mins / 60).toFixed(1).replace(/\.0$/, "");
}
function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
}
function weekLabel(date: string): string {
  const end = new Date(Date.parse(`${date}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const f = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`));
  return `${f(date)} – ${f(end)}`;
}

/** What the other parent is actually doing that day - null when it isn't known yet. */
function dadLabel(day: PlanDay): string | null {
  if (!day.dadKnown) return null;
  if (!day.dadShift) return "Off";
  return classifyShiftKind(day.dadShift.startLocal, day.dadShift.endLocal) === "NIGHT" ? "Night" : "Day";
}

function Metrics({ m }: { m: PlanMetrics }) {
  return (
    <div className="plan-metrics">
      <span className={m.hoursExact ? "ok" : "warn"}>
        {hours(m.totalPaidMinutes)} / {hours(m.requiredMinutes)} hours
      </span>
      <span className={m.childcareConflicts === 0 ? "ok" : "bad"}>
        {m.childcareConflicts === 0
          ? "No childcare conflicts"
          : `${m.childcareConflicts} childcare conflict${m.childcareConflicts > 1 ? "s" : ""}`}
      </span>
      <span className={m.familyDaysTogether > 0 ? "love" : undefined}>
        ❤️ {m.familyDaysTogether} day{m.familyDaysTogether === 1 ? "" : "s"} off together
        {m.coupleDaytimeOff > 0 ? ` (${m.coupleDaytimeOff} while kids at school)` : ""}
      </span>
    </div>
  );
}

function PlanCard({
  plan,
  label,
  otherParentName,
  onApply,
  busy,
  applied,
  unsafe,
  onReview,
}: {
  plan: WeekPlan;
  label: string;
  /** shown as initials opposite the title, and alongside each day, so the
   * other parent can see their own already-fixed shift without leaving this
   * sheet to decide whether the suggested plan below works for them too. */
  otherParentName: string | null;
  onApply: () => void;
  busy: boolean;
  applied?: boolean;
  /** true for the closest option when no conflict-free plan exists. */
  unsafe?: boolean;
  onReview?: () => void;
}) {
  const otherInitials = otherParentName ? initials(otherParentName) : null;
  return (
    <div className="plan-card">
      <div className="plan-card-header">
        <div className="plan-card-title">{label}</div>
        {otherInitials && (
          <span className="plan-col-head" title={`${otherParentName}'s own shift`}>
            {otherInitials}
          </span>
        )}
      </div>
      <div className="plan-rows">
        {plan.days.map((d) => {
          const dad = dadLabel(d);
          return (
            <div className="plan-row" key={d.date}>
              <span className="plan-row-day">{shortDay(d.date)}</span>
              <span className={d.option || (d.locked && d.lockedLabel && d.lockedLabel !== "Off") ? "plan-row-shift" : "plan-row-off"}>
                {d.locked ? d.lockedLabel ?? "Off" : d.option ? d.option.name : "Off"}
                {d.locked && <Lock size={11} style={{ marginLeft: 5, verticalAlign: "middle" }} />}
              </span>
              <span className="plan-row-dad">{dad ?? ""}</span>
            </div>
          );
        })}
      </div>
      <Metrics m={plan.metrics} />
      {plan.conflicts.length > 0 && (
        <ul className="plan-conflicts">
          {plan.conflicts.map((c, i) => (
            <li key={i}>{c.explanation}</li>
          ))}
        </ul>
      )}
      {applied ? (
        <div className="pill pill-good btn-block" style={{ justifyContent: "center", padding: "13px 20px" }}>
          <Check size={15} /> Applied
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          {onReview && <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onReview}>Review & edit</button>}
          <button
            className={unsafe ? "btn btn-ghost" : "btn btn-primary"}
            style={{ flex: 1 }}
            disabled={busy}
            onClick={onApply}
          >
            {busy ? "Applying…" : unsafe ? "Apply with gap" : "Apply"}
          </button>
        </div>
      )}
    </div>
  );
}

export function PlanWeekSheet({
  weekStarts,
  onClose,
  onApplied,
}: {
  weekStarts: string[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const isMonth = weekStarts.length > 1;
  // A calendar month is at most 6 weeks; anything longer is a year plan.
  const scopeWord = weekStarts.length <= 1 ? "week" : weekStarts.length > 6 ? "year" : "month";
  const [ownerName, setOwnerName] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [eligibleOwners, setEligibleOwners] = useState<{ id: string; name: string }[]>([]);
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [previewDays, setPreviewDays] = useState<CalendarDayView[]>([]);
  const [review, setReview] = useState<ReviewDraft | null>(null);
  const [previewConflicts, setPreviewConflicts] = useState<PlanConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which weeks (by weekStart) have already been applied this time the sheet
  // is open - tracked locally so applying one week never has to reload or
  // close the sheet just to show that it worked; the other weeks' suggestions
  // stay exactly as they were so they can still be reviewed and applied too.
  const [appliedWeeks, setAppliedWeeks] = useState<Set<string>>(new Set());

  // How many of the weeks asked for actually have a safe plan. `best` is only
  // ever set for a childcare-safe plan, so this is simply a count of those.
  const overall = { safeWeeks: plans.filter((p) => p.best).length };
  const exhaustiveNoSafePlans = plans.filter((p) => !p.best).every((p) => p.diagnostics.exhaustive);
  const noSafeSearchSummary = (results: PlanResponse[]) => {
    const generated = results.reduce((sum, p) => sum + p.diagnostics.generated, 0);
    const safe = results.reduce((sum, p) => sum + p.diagnostics.safe, 0);
    return `The search was too large to check exhaustively (${generated} options checked; ${safe} safe). See the reasons below.`;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const members = await apiFetch<{ members: { id: string; name: string; kind: string; requiredWeeklyMinutes: number | null }[] }>(
        "/api/family-members",
      );
      const owners = members.members.filter((m) => m.kind === "PARENT" && m.requiredWeeklyMinutes != null);
      setEligibleOwners(owners);
      const owner = owners.find((m) => m.id === ownerId) ?? owners[0];
      if (!owner) {
        setError("Set a weekly hours requirement for a parent in Settings first, then the planner can suggest their shifts.");
        return;
      }
      setOwnerName(owner.name);
      setOwnerId(owner.id);
      // One request for every week together (even just one), computed
      // sequentially server-side - a week's own suggested Sunday needs to be
      // visible to the next week's Monday, which independent parallel
      // requests could never see (see getMumMonthPlan's comment for why).
      const { plans: results } = await apiFetch<{ plans: PlanResponse[] }>(
        `/api/insights/plan-mum-week?ownerId=${owner.id}&weekStarts=${weekStarts.join(",")}`,
      );
      setPlans(results);
      const [types, calendar] = await Promise.all([
        apiFetch<{ types: ShiftType[] }>(`/api/shift-types?ownerId=${owner.id}`),
        apiFetch<{ days: CalendarDayView[] }>(`/api/calendar?from=${weekStarts[0]}&to=${new Date(Date.parse(`${weekStarts[weekStarts.length - 1]}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)}`),
      ]);
      setShiftTypes(types.types);
      setPreviewDays(calendar.days);
      const first = results.find((p) => p.best)?.best ?? results.find((p) => p.bestWithConflicts)?.bestWithConflicts;
      const firstResponse = results.find((p) => p.best || p.bestWithConflicts);
      if (first && firstResponse) {
        setReview({ plan: structuredClone(first), weekStart: firstResponse.weekStart, allowConflicts: !firstResponse.best });
        setPreviewConflicts(first.conflicts);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build a plan");
    } finally {
      setLoading(false);
    }
  }, [weekStarts, ownerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function applyPlan(plan: WeekPlan, allowConflicts = false) {
    if (!ownerId) return;
    const assignments = plan.days.filter((d) => !d.locked).map((d) => ({ date: d.date, shiftTypeId: d.option?.id ?? null }));
    // The server re-checks these assignments and refuses them if they would
    // leave the children uncovered, so applying a plan with a known gap has to
    // say so explicitly rather than slipping through.
    await apiFetch("/api/insights/plan-mum-week", {
      method: "POST",
      body: JSON.stringify({ ownerId, assignments, allowConflicts }),
    });
  }

  function assignmentsFor(plan: WeekPlan) {
    return plan.days.filter((d) => !d.locked).map((d) => ({ date: d.date, shiftTypeId: d.option?.id ?? null }));
  }

  async function refreshPreview(next: ReviewDraft) {
    setReview(next);
    if (!ownerId) return;
    try {
      const result = await apiFetch<{ conflicts: PlanConflict[] }>("/api/insights/plan-mum-week", {
        method: "POST",
        body: JSON.stringify({ ownerId, assignments: assignmentsFor(next.plan), preview: true }),
      });
      setPreviewConflicts(result.conflicts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check that change");
    }
  }

  function editReviewDay(date: string, shiftTypeId: string) {
    if (!review) return;
    const option = shiftTypeId ? shiftTypes.find((t) => t.id === shiftTypeId) ?? null : null;
    const plan = {
      ...review.plan,
      days: review.plan.days.map((day) => day.date === date ? { ...day, option } : day),
    };
    const totalPaidMinutes = plan.days.reduce((sum, day) => sum + (day.option?.paidMinutes ?? 0), 0);
    plan.metrics = { ...plan.metrics, totalPaidMinutes, hoursExact: totalPaidMinutes === plan.metrics.requiredMinutes };
    void refreshPreview({ ...review, plan });
  }

  async function applyOne(plan: WeekPlan, weekStart: string, allowConflicts = false) {
    setBusy(true);
    setError(null);
    try {
      await applyPlan(plan, allowConflicts);
      onApplied();
      if (!isMonth) {
        onClose();
      } else {
        // Mark this week applied in place - no refetch, so the sheet stays
        // exactly as it was for every other week and doesn't flash back to
        // a loading state (the actual bug being fixed here).
        setAppliedWeeks((prev) => new Set(prev).add(weekStart));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply the plan");
    } finally {
      setBusy(false);
    }
  }

  async function applyAll() {
    setBusy(true);
    setError(null);
    try {
      // Only the weeks with a safe plan. A week where every option has a gap
      // is left alone deliberately - it needs a decision, not a bulk apply.
      for (const p of plans) if (p.best) await applyPlan(p.best);
      onApplied();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply the plans");
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <strong style={{ fontSize: 17, display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={18} /> {ownerName ? `Plan ${ownerName}'s ${scopeWord}` : "Plan shifts"}
          </strong>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ padding: 8, minHeight: "auto" }}>
            <X size={22} />
          </button>
        </div>

        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -6, marginBottom: 12 }}>
          Suggestions are a starting point, not an automatic decision. Review or change each unlocked day, then apply only when it looks right.
        </p>

        {eligibleOwners.length > 1 && (
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Whose weekly-hours plan are you reviewing?</label>
            <select value={ownerId ?? ""} onChange={(e) => { setOwnerId(e.target.value); setReview(null); }}>
              {eligibleOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
            </select>
          </div>
        )}

        {loading && <div className="empty-state">Working out the best fit…</div>}
        {error && <div className="error-banner">{error}</div>}

        {/* The childcare verdict is stated for the WHOLE plan, once. Saying
            "no childcare conflicts" on each week's own card would be a claim
            about that week only, which is how a conflict spanning two weeks
            used to be able to hide between two reassuring cards. */}
        {!loading && !error && plans.length > 0 && (
          <div className={overall.safeWeeks === plans.length ? "pill pill-good" : "setup-banner"} style={{ marginBottom: 12 }}>
            {overall.safeWeeks === plans.length
              ? plans.length === 1
                ? "This plan keeps the children covered all week."
                : `All ${plans.length} weeks keep the children covered.`
              : overall.safeWeeks === 0
                ? exhaustiveNoSafePlans
                  ? "No safe plan was found. Every option leaves a gap where nobody is available — see the reasons below."
                  : noSafeSearchSummary(plans)
                : `${overall.safeWeeks} of ${plans.length} weeks have a safe plan. The rest leave a gap where nobody is available — see the reasons below.`}
          </div>
        )}

        {!loading && isMonth && plans.some((p) => p.best) && (
          <button className="btn btn-primary btn-block" disabled={busy} onClick={applyAll} style={{ marginBottom: 14 }}>
            {busy ? "Applying…" : `Apply best fit for the whole ${scopeWord}`}
          </button>
        )}

        <div className="planner-workspace">
        <div className="planner-suggestions">
        {!loading && plans.map((data, wi) => (
            <div key={data.weekStart} style={{ marginBottom: isMonth ? 18 : 0 }}>
              {isMonth && <div className="plan-alt-heading" style={{ marginBottom: 8 }}>Week of {weekLabel(data.weekStart)}</div>}
              {data.message && <div className="setup-banner">{data.message}</div>}
              {data.bestWithConflicts && (
                <PlanCard
                  plan={data.bestWithConflicts}
                  label={data.best ? "Hits the hours, but leaves a gap" : "Closest option — not safe as it stands"}
                  otherParentName={data.otherParentName}
                  onApply={() => applyOne(data.bestWithConflicts!, data.weekStart, true)}
                  onReview={() => void refreshPreview({ plan: structuredClone(data.bestWithConflicts!), weekStart: data.weekStart, allowConflicts: true })}
                  busy={busy}
                  applied={appliedWeeks.has(data.weekStart)}
                  unsafe
                />
              )}
              {data.best && (
                <>
                  <PlanCard
                    plan={data.best}
                    label={isMonth ? "Best fit" : "Best fit"}
                    otherParentName={data.otherParentName}
                    onApply={() => applyOne(data.best!, data.weekStart)}
                    onReview={() => void refreshPreview({ plan: structuredClone(data.best!), weekStart: data.weekStart, allowConflicts: false })}
                    busy={busy}
                    applied={appliedWeeks.has(data.weekStart)}
                  />
                  {!isMonth && data.alternatives.length > 0 && (
                    <div className="plan-alt-heading">
                      <Check size={13} /> Other options
                    </div>
                  )}
                  {!isMonth &&
                    data.alternatives.map((alt, i) => (
                      <PlanCard
                        key={i}
                        plan={alt}
                        label={`Alternative ${i + 1}`}
                        otherParentName={data.otherParentName}
                        onApply={() => applyOne(alt, data.weekStart)}
                        onReview={() => void refreshPreview({ plan: structuredClone(alt), weekStart: data.weekStart, allowConflicts: false })}
                        busy={busy}
                        applied={appliedWeeks.has(data.weekStart)}
                      />
                    ))}
                </>
              )}
              {wi === plans.length - 1 && (
                <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 6 }}>
                  Locked days are never changed. Each week is planned to hit the hours on its own.
                </p>
              )}
            </div>
          ))}
        </div>
        <aside className="planner-review" aria-live="polite">
          <div className="plan-card" style={{ position: "sticky", top: 12 }}>
            <div className="plan-card-title">Your checked plan</div>
            {!review ? <p className="planner-muted">Choose “Review & edit” on a suggestion. Nothing has been changed yet.</p> : (
              <>
                <p className="planner-muted">Week of {weekLabel(review.weekStart)}. Change an unlocked day; this panel checks it before you apply.</p>
                <div className="review-days">
                  {review.plan.days.map((day) => {
                    const calendar = previewDays.find((d) => d.date === day.date);
                    const children = calendar?.members.filter((m) => m.memberKind === "CHILD") ?? [];
                    const schoolNote = children.length === 0 ? "" : children.every((child) => child.label.startsWith("School")) ? "School day" : children.map((child) => child.label.replace(/^Home ·?\s*/, "")).filter(Boolean).join(" · ");
                    return <div className="review-day" key={day.date}>
                      <div><strong>{shortDay(day.date)}</strong><span>{schoolNote || "No school info"}</span></div>
                      {day.locked ? <span className="review-locked">{day.lockedLabel ?? "Off"} <Lock size={11} /></span> : (
                        <select value={day.option?.id ?? ""} onChange={(e) => editReviewDay(day.date, e.target.value)}>
                          <option value="">Off</option>
                          {shiftTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {type.startLocal}–{type.endLocal}</option>)}
                        </select>
                      )}
                    </div>;
                  })}
                </div>
                <Metrics m={{ ...review.plan.metrics, childcareConflicts: previewConflicts.length }} />
                {previewConflicts.length > 0 ? <ul className="plan-conflicts">{previewConflicts.map((conflict, index) => <li key={index}>{conflict.explanation}</li>)}</ul> : <div className="pill pill-good">Checked: no childcare gaps in this edited plan</div>}
                <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={() => applyOne(review.plan, review.weekStart, review.allowConflicts || previewConflicts.length > 0)}>
                  {busy ? "Applying…" : previewConflicts.length > 0 ? "Apply anyway, with the gaps above" : "Apply reviewed plan"}
                </button>
              </>
            )}
          </div>
        </aside>
        </div>
      </div>
    </div>
  );
}
