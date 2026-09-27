"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

type Rule = {
  maxUnsupervisedMinutes: number;
  appliesWeekends: boolean;
  minSupervisorAge: number | null;
  strictPickupAge: number | null;
  pickupBufferMinutes: number;
};

export function ChildcareRuleSection() {
  const [rule, setRule] = useState<Rule | null>(null);
  const [hours, setHours] = useState(3);
  const [appliesWeekends, setAppliesWeekends] = useState(true);
  const [minSupervisorAge, setMinSupervisorAge] = useState<string>("13");
  const [strictPickupAge, setStrictPickupAge] = useState<string>("");
  const [pickupBufferMinutes, setPickupBufferMinutes] = useState(30);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ rule: Rule | null }>("/api/childcare-rule").then((d) => {
      if (d.rule) {
        setRule(d.rule);
        setHours(d.rule.maxUnsupervisedMinutes / 60);
        setAppliesWeekends(d.rule.appliesWeekends);
        setMinSupervisorAge(d.rule.minSupervisorAge != null ? String(d.rule.minSupervisorAge) : "");
        setStrictPickupAge(d.rule.strictPickupAge != null ? String(d.rule.strictPickupAge) : "");
        setPickupBufferMinutes(d.rule.pickupBufferMinutes ?? 30);
      }
    });
  }, []);

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
        }),
      });
      setSaved(true);
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
        {strictPickupAge && (
          <div className="field">
            <label>Drop-off/pick-up buffer either side of school hours (minutes)</label>
            <input
              type="number"
              min={0}
              value={pickupBufferMinutes}
              onChange={(e) => setPickupBufferMinutes(Number(e.target.value))}
            />
          </div>
        )}
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
