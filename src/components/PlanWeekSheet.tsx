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
      <span>{m.familyDaysTogether} family day{m.familyDaysTogether === 1 ? "" : "s"} preserved</span>
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
  weekStart,
  onClose,
  onApplied,
}: {
  weekStart: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [data, setData] = useState<PlanResponse | null>(null);
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
        setData(null);
        setError("Set a weekly hours requirement for a parent in Settings first, then the planner can suggest their week.");
        return;
      }
      const res = await apiFetch<PlanResponse>(`/api/insights/plan-mum-week?ownerId=${owner.id}&weekStart=${weekStart}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build a plan");
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  async function apply(plan: WeekPlan) {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      // Only send non-locked days; locked days are never touched.
      const assignments = plan.days
        .filter((d) => !d.locked)
        .map((d) => ({ date: d.date, shiftTypeId: d.option?.id ?? null }));
      await apiFetch("/api/insights/plan-mum-week", {
        method: "POST",
        body: JSON.stringify({ ownerId: data.ownerId, assignments }),
      });
      onApplied();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply the plan");
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <strong style={{ fontSize: 17, display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={18} /> {data?.ownerName ? `Plan ${data.ownerName}'s week` : "Plan the week"}
          </strong>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ padding: 8, minHeight: "auto" }}>
            <X size={22} />
          </button>
        </div>

        {loading && <div className="empty-state">Working out the best fit…</div>}
        {error && <div className="error-banner">{error}</div>}

        {!loading && data?.message && !data.best && <div className="setup-banner">{data.message}</div>}

        {!loading && data?.best && (
          <>
            <PlanCard plan={data.best} label="Best fit" onApply={() => apply(data.best!)} busy={busy} />
            {data.alternatives.length > 0 && (
              <div className="plan-alt-heading">
                <Check size={13} /> Other options
              </div>
            )}
            {data.alternatives.map((alt, i) => (
              <PlanCard key={i} plan={alt} label={`Alternative ${i + 1}`} onApply={() => apply(alt)} busy={busy} />
            ))}
            <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 6 }}>
              Nothing changes until you apply. Locked days are never altered.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
