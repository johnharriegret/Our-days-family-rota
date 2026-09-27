"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

export type ChildcareRule = {
  maxUnsupervisedMinutes: number;
  appliesWeekends: boolean;
  minSupervisorAge: number | null;
  strictPickupAge: number | null;
  pickupBufferMinutes: number;
  schoolRunMorningFromLocal: string | null;
};

function draftFrom(rule: ChildcareRule | null) {
  return {
    hours: rule ? rule.maxUnsupervisedMinutes / 60 : 3,
    appliesWeekends: rule?.appliesWeekends ?? true,
    minSupervisorAge: rule?.minSupervisorAge != null ? String(rule.minSupervisorAge) : "13",
    strictPickupAge: rule?.strictPickupAge != null ? String(rule.strictPickupAge) : "",
    pickupBufferMinutes: rule?.pickupBufferMinutes ?? 30,
    schoolRunMorningFromLocal: rule?.schoolRunMorningFromLocal ?? "06:00",
  };
}

export function ChildcareRuleSection({
  initialRule,
  onChanged,
}: {
  /** Already loaded by the Settings page - no fetch needed on mount. */
  initialRule: ChildcareRule | null;
  /** Called after saving, so the Settings page's own bootstrap stays in sync. */
  onChanged: () => void;
}) {
  const [rule, setRule] = useState(initialRule);
  const draft0 = draftFrom(initialRule);
  const [hours, setHours] = useState(draft0.hours);
  const [appliesWeekends, setAppliesWeekends] = useState(draft0.appliesWeekends);
  const [minSupervisorAge, setMinSupervisorAge] = useState(draft0.minSupervisorAge);
  const [strictPickupAge, setStrictPickupAge] = useState(draft0.strictPickupAge);
  const [pickupBufferMinutes, setPickupBufferMinutes] = useState(draft0.pickupBufferMinutes);
  const [schoolRunMorningFromLocal, setSchoolRunMorningFromLocal] = useState(draft0.schoolRunMorningFromLocal);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRule(initialRule);
    const d = draftFrom(initialRule);
    setHours(d.hours);
    setAppliesWeekends(d.appliesWeekends);
    setMinSupervisorAge(d.minSupervisorAge);
    setStrictPickupAge(d.strictPickupAge);
    setPickupBufferMinutes(d.pickupBufferMinutes);
    setSchoolRunMorningFromLocal(d.schoolRunMorningFromLocal);
  }, [initialRule]);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await apiFetch("/api/childcare-rule", {
        method: "POST",
        body: JSON.stringify({
          maxUnsupervisedMinutes: Math.round(hours * 60),
          appliesWeekends,
          minSupervisorAge: minSupervisorAge ? Number(minSupervisorAge) : null,
          strictPickupAge: strictPickupAge ? Number(strictPickupAge) : null,
          pickupBufferMinutes,
          schoolRunMorningFromLocal,
        }),
      });
      setSaved(true);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Childcare rule</h2>
      <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 14 }}>
        How long can the kids be left without an adult home, and when.
      </p>
      <div className="field">
        <label>Maximum unsupervised time (hours)</label>
        <input type="number" step="0.5" min={0} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 14 }}>
        <input
          type="checkbox"
          checked={appliesWeekends}
          onChange={(e) => setAppliesWeekends(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        Always allow this on weekends
      </label>
      <div className="field">
        <label>Also allow it when this age or older is home (leave blank to disable)</label>
        <input
          type="number"
          min={0}
          placeholder="e.g. 13"
          value={minSupervisorAge}
          onChange={(e) => setMinSupervisorAge(e.target.value)}
        />
      </div>

      <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0 14px", paddingTop: 14 }}>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 10 }}>
          On a school day somebody has to wake the children, get them ready and take them — and be there to collect
          them. From the time below until school starts, and for the buffer after school ends, an adult has to be at
          home: neither an older sibling nor the {hours}-hour allowance counts for that part of the day.
        </p>
        <div className="field">
          <label>A school morning needs an adult at home from</label>
          <input
            type="time"
            value={schoolRunMorningFromLocal}
            onChange={(e) => setSchoolRunMorningFromLocal(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Adult needed for this long after school ends (minutes)</label>
          <input
            type="number"
            min={0}
            value={pickupBufferMinutes}
            onChange={(e) => setPickupBufferMinutes(Number(e.target.value))}
          />
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0 14px", paddingTop: 14 }}>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 10 }}>
          A young child (e.g. a toddler) can&apos;t be collected from school/nursery by an older sibling — this makes
          sure an actual adult is always the one covering their drop-off and pick-up, whoever else is home.
        </p>
        <div className="field">
          <label>Below this age, an adult (not a sibling) must do their school run (leave blank to disable)</label>
          <input
            type="number"
            min={0}
            placeholder="e.g. 5"
            value={strictPickupAge}
            onChange={(e) => setStrictPickupAge(e.target.value)}
          />
        </div>
      </div>

      {saved && <div className="pill pill-good" style={{ marginBottom: 12 }}>Saved</div>}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
        Save rule
      </button>
      {rule === null && (
        <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 10 }}>No rule set yet — using the defaults above.</p>
      )}
    </div>
  );
}
