"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { MEMBER_COLORS } from "@/lib/constants";
import { MemberAvatar } from "@/components/memberIcon";
import type { FamilyMember } from "@/lib/clientTypes";

export function FamilyMembersSection({
  members,
  schools,
  onChanged,
}: {
  members: FamilyMember[];
  schools: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"PARENT" | "CHILD">("CHILD");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [requiredWeeklyMinutes, setRequiredWeeklyMinutes] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addMember() {
    if (!name.trim()) return setError("Give them a name");
    setBusy(true);
    setError(null);
    try {
      const usedTokens = new Set(members.map((m) => m.colorToken));
      const color = MEMBER_COLORS.find((c) => !usedTokens.has(c.token)) ?? MEMBER_COLORS[0];
      await apiFetch("/api/family-members", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          kind,
          dateOfBirth: dateOfBirth || null,
          schoolId: schoolId || null,
          colorToken: color.token,
          icon: kind === "PARENT" ? (members.some((m) => m.kind === "PARENT") ? "mum" : "dad") : "child",
          requiredWeeklyMinutes: requiredWeeklyMinutes ? Number(requiredWeeklyMinutes) : null,
        }),
      });
      setName("");
      setDateOfBirth("");
      setSchoolId("");
      setRequiredWeeklyMinutes("");
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Family members</h2>
      {members.map((m) => (
        <div className="row" key={m.id}>
          <MemberAvatar icon={m.icon} colorToken={m.colorToken} />
          <div>
            <div className="row-title">{m.name}</div>
            <div className="row-sub">
              {m.kind === "PARENT" ? "Parent" : "Child"}
              {m.requiredWeeklyMinutes ? ` · ${(m.requiredWeeklyMinutes / 60).toFixed(1)}h/week` : ""}
            </div>
          </div>
        </div>
      ))}

      {!adding && (
        <button className="btn btn-secondary btn-block" onClick={() => setAdding(true)} style={{ marginTop: 10 }}>
          + Add family member
        </button>
      )}

      {adding && (
        <div style={{ marginTop: 12 }}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as "PARENT" | "CHILD")}>
              <option value="PARENT">Parent</option>
              <option value="CHILD">Child</option>
            </select>
          </div>
          {kind === "CHILD" && (
            <>
              <div className="field">
                <label>Date of birth</label>
                <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
              </div>
              {schools.length > 0 && (
                <div className="field">
                  <label>School</label>
                  <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
                    <option value="">None yet</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          {kind === "PARENT" && (
            <div className="field">
              <label>Hard weekly hours requirement (optional, e.g. 37.5)</label>
              <input
                type="number"
                step="0.5"
                placeholder="Leave blank if none"
                value={requiredWeeklyMinutes ? Number(requiredWeeklyMinutes) / 60 : ""}
                onChange={(e) => setRequiredWeeklyMinutes(e.target.value ? String(Number(e.target.value) * 60) : "")}
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={addMember}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
