"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Lock, Sparkles, X } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { initials } from "@/lib/initials";
import { classifyShiftKind } from "@/lib/quickShift";

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
type WeekPlan = { days: PlanDay[]; metrics: PlanMetrics };
type PlanResponse = {
  best: WeekPlan | null;
  alternatives: WeekPlan[];
  message?: string;
  ownerId: string;
  ownerName: string;
  otherParentName: string | null;
  weekStart: string;
  requiredMinutes: number | null;
};

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
}) {
  const otherInitials = otherParentName ? initials(otherParentName) : null;
  return (
    <div className="plan-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="plan-card-title">{label}</div>
        {otherInitials && (
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }} title={`${otherParentName}'s own shift`}>
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
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {dad && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                    {otherInitials} {dad}
                  </span>
                )}
                <span className={d.option || (d.locked && d.lockedLabel && d.lockedLabel !== "Off") ? "plan-row-shift" : "plan-row-off"}>
                  {d.locked ? d.lockedLabel ?? "Off" : d.option ? d.option.name : "Off"}
                  {d.locked && <Lock size={11} style={{ marginLeft: 5, verticalAlign: "middle" }} />}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <Metrics m={plan.metrics} />
      {applied ? (
        <div className="pill pill-good btn-block" style={{ justifyContent: "center", padding: "13px 20px" }}>
          <Check size={15} /> Applied
        </div>
      ) : (
        <button className="btn btn-primary btn-block" disabled={busy} onClick={onApply}>
          {busy ? "Applying…" : "Apply this plan"}
        </button>
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
  const [ownerName, setOwnerName] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which weeks (by weekStart) have already been applied this time the sheet
  // is open - tracked locally so applying one week never has to reload or
  // close the sheet just to show that it worked; the other weeks' suggestions
  // stay exactly as they were so they can still be reviewed and applied too.
  const [appliedWeeks, setAppliedWeeks] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const members = await apiFetch<{ members: { id: string; name: string; kind: string; requiredWeeklyMinutes: number | null }[] }>(
        "/api/family-members",
      );
      const owner = members.members.find((m) => m.kind === "PARENT" && m.requiredWeeklyMinutes != null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build a plan");
    } finally {
      setLoading(false);
    }
  }, [weekStarts]);

  useEffect(() => {
    load();
  }, [load]);

  async function applyPlan(plan: WeekPlan) {
    if (!ownerId) return;
    const assignments = plan.days.filter((d) => !d.locked).map((d) => ({ date: d.date, shiftTypeId: d.option?.id ?? null }));
    await apiFetch("/api/insights/plan-mum-week", {
      method: "POST",
      body: JSON.stringify({ ownerId, assignments }),
    });
  }

  async function applyOne(plan: WeekPlan, weekStart: string) {
    setBusy(true);
    setError(null);
    try {
      await applyPlan(plan);
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
            <Sparkles size={18} /> {ownerName ? `Plan ${ownerName}'s ${isMonth ? "month" : "week"}` : "Plan shifts"}
          </strong>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ padding: 8, minHeight: "auto" }}>
            <X size={22} />
          </button>
        </div>

        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -6, marginBottom: 12 }}>
          Suggested shifts to request that keep the hours exact and give you the most time off together. Nothing changes
          until you apply.
        </p>

        {loading && <div className="empty-state">Working out the best fit…</div>}
        {error && <div className="error-banner">{error}</div>}

        {!loading && isMonth && plans.some((p) => p.best) && (
          <button className="btn btn-primary btn-block" disabled={busy} onClick={applyAll} style={{ marginBottom: 14 }}>
            {busy ? "Applying…" : "Apply best fit for the whole month"}
          </button>
        )}

        {!loading &&
          plans.map((data, wi) => (
            <div key={data.weekStart} style={{ marginBottom: isMonth ? 18 : 0 }}>
              {isMonth && <div className="plan-alt-heading" style={{ marginBottom: 8 }}>Week of {weekLabel(data.weekStart)}</div>}
              {data.message && !data.best && <div className="setup-banner">{data.message}</div>}
              {data.best && (
                <>
                  <PlanCard
                    plan={data.best}
                    label={isMonth ? "Best fit" : "Best fit"}
                    otherParentName={data.otherParentName}
                    onApply={() => applyOne(data.best!, data.weekStart)}
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
    </div>
  );
}
