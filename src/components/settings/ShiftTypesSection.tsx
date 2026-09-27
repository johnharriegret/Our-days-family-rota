"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/client";
import type { FamilyMember, ShiftType } from "@/lib/clientTypes";

const PRESETS = [
  { name: "Early", startLocal: "07:00", endLocal: "14:30", paidMinutes: 450 },
  { name: "Late", startLocal: "13:30", endLocal: "21:00", paidMinutes: 450 },
  { name: "Long Day", startLocal: "07:00", endLocal: "20:00", paidMinutes: 750 },
  { name: "Night", startLocal: "20:00", endLocal: "08:00", paidMinutes: 690 },
];

export function ShiftTypesSection({
  parents,
  initialShiftTypesByOwnerId,
}: {
  parents: FamilyMember[];
  /** Every parent's shift types, already loaded by the Settings page - used
   * to seed the initial view with no fetch, including when the dropdown
   * switches to a different parent. A fresh fetch still happens after adding
   * or removing a type, straight from the source of truth. */
  initialShiftTypesByOwnerId: Record<string, ShiftType[]>;
}) {
  const [ownerId, setOwnerId] = useState(parents[0]?.id ?? "");
  const [types, setTypes] = useState<ShiftType[]>(initialShiftTypesByOwnerId[parents[0]?.id ?? ""] ?? []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [startLocal, setStartLocal] = useState("07:00");
  const [endLocal, setEndLocal] = useState("19:00");
  const [paidMinutes, setPaidMinutes] = useState(720);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching parent needs no round trip - every parent's types are already
  // loaded. Only a save/delete (via load() below) hits the network.
  useEffect(() => {
    setTypes(initialShiftTypesByOwnerId[ownerId] ?? []);
  }, [ownerId, initialShiftTypesByOwnerId]);

  function load() {
    if (!ownerId) return;
    apiFetch<{ types: ShiftType[] }>(`/api/shift-types?ownerId=${ownerId}`).then((d) => setTypes(d.types));
  }

  async function addType(preset?: (typeof PRESETS)[number]) {
    setBusy(true);
    setError(null);
    try {
      const payload = preset ?? { name, startLocal, endLocal, paidMinutes };
      if (!payload.name.trim()) return setError("Give the shift a name");
      await apiFetch("/api/shift-types", {
        method: "POST",
        body: JSON.stringify({ ownerId, ...payload, color: "#6a63d1" }),
      });
      setName("");
      setAdding(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function removeType(id: string) {
    await apiFetch(`/api/shift-types/${id}`, { method: "DELETE" });
    load();
  }

  if (parents.length === 0) return null;
  const existingNames = new Set(types.map((t) => t.name));
  const missingPresets = PRESETS.filter((p) => !existingNames.has(p.name));

  return (
    <div className="card">
      <h2>One-tap shift types</h2>
      {parents.length > 1 && (
        <div className="field">
          <label>For whom?</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {types.map((t) => (
        <div className="row" key={t.id}>
          <div className="avatar" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            {t.startLocal.slice(0, 2)}
          </div>
          <div style={{ flex: 1 }}>
            <div className="row-title">{t.name}</div>
            <div className="row-sub">
              {t.startLocal}{"–"}{t.endLocal} {"·"} {(t.paidMinutes / 60).toFixed(1)}h paid
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => removeType(t.id)} aria-label={`Remove ${t.name}`} style={{ minHeight: "auto", padding: 8 }}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}

      {error && <div className="error-banner">{error}</div>}

      {missingPresets.length > 0 && (
        <div className="choice-grid" style={{ marginTop: 10, marginBottom: 10 }}>
          {missingPresets.map((p) => (
            <button key={p.name} className="choice-btn" disabled={busy} onClick={() => addType(p)}>
              + {p.name}
            </button>
          ))}
        </div>
      )}

      {!adding && (
        <button className="btn btn-secondary btn-block" onClick={() => setAdding(true)}>
          + Custom shift type
        </button>
      )}

      {adding && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Study day" autoFocus />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Start</label>
              <input type="time" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>End</label>
              <input type="time" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Paid minutes</label>
            <input type="number" value={paidMinutes} onChange={(e) => setPaidMinutes(Number(e.target.value))} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => addType()}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
