"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

type Rule = { maxUnsupervisedMinutes: number; appliesWeekends: boolean; minSupervisorAge: number | null };

export function ChildcareRuleSection() {
  const [rule, setRule] = useState<Rule | null>(null);
  const [hours, setHours] = useState(3);
  const [appliesWeekends, setAppliesWeekends] = useState(true);
  const [minSupervisorAge, setMinSupervisorAge] = useState<string>("13");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ rule: Rule | null }>("/api/childcare-rule").then((d) => {
      if (d.rule) {
        setRule(d.rule);
        setHours(d.rule.maxUnsupervisedMinutes / 60);
        setAppliesWeekends(d.rule.appliesWeekends);
        setMinSupervisorAge(d.rule.minSupervisorAge != null ? String(d.rule.minSupervisorAge) : "");
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
