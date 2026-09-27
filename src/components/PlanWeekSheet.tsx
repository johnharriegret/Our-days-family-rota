"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Lock, Sparkles, X } from "lucide-react";
import { apiFetch } from "@/lib/client";

type PlanOption = { id: string; name: string; startLocal: string; endLocal: string; paidMinutes: number };
type PlanDay = { date: string; option: PlanOption | null; locked: boolean; lockedLabel: string | null };
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

function PlanCard({ plan, label, onApply, busy }: { plan: WeekPlan; label: string; onApply: () => void; busy: boolean }) {
  return (
    <div className="plan-card">
      <div className="plan-card-title">{label}</div>
      <div className="plan-rows">
        {plan.days.map((d) => (
          <div className="plan-row" key={d.date}>
            <span className="plan-row-day">{shortDay(d.date)}</span>
            <span className={d.option || (d.locked && d.lockedLabel && d.lockedLabel !== "Off") ? "plan-row-shift" : "plan-row-off"}>
              {d.locked ? d.lockedLabel ?? "Off" : d.option ? d.option.name : "Off"}
              {d.locked && <Lock size={11} style={{ marginLeft: 5, verticalAlign: "middle" }} />}
            </span>
          </div>
        ))}
      </div>
      <Metrics m={plan.metrics} />
      <button className="btn btn-primary btn-block" disabled={busy} onClick={onApply}>
        {busy ? "Applying…" : "Apply this plan"}
      </button>
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
      const results = await Promise.all(
        weekStarts.map((ws) => apiFetch<PlanResponse>(`/api/insights/plan-mum-week?ownerId=${owner.id}&weekStart=${ws}`)),
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

  async function applyOne(plan: WeekPlan) {
    setBusy(true);
    setError(null);
    try {
      await applyPlan(plan);
      onApplied();
      if (!isMonth) onClose();
      else await load();
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
                  <PlanCard plan={data.best} label={isMonth ? "Best fit" : "Best fit"} onApply={() => applyOne(data.best!)} busy={busy} />
                  {!isMonth && data.alternatives.length > 0 && (
                    <div className="plan-alt-heading">
                      <Check size={13} /> Other options
                    </div>
                  )}
                  {!isMonth &&
                    data.alternatives.map((alt, i) => (
                      <PlanCard key={i} plan={alt} label={`Alternative ${i + 1}`} onApply={() => applyOne(alt)} busy={busy} />
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
