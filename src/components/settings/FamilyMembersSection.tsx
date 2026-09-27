"use client";

import { useState } from "react";
import { Palette } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { MEMBER_COLORS } from "@/lib/constants";
import { MemberAvatar } from "@/components/memberIcon";
import { resolveQuickShiftConfig } from "@/lib/quickShift";
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

  // Quick-fill day/night colour + time editor, one parent open at a time.
  const [editingColorsFor, setEditingColorsFor] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState<{
    dayColor: string;
    nightColor: string;
    dayStartLocal: string;
    dayEndLocal: string;
    nightStartLocal: string;
    nightEndLocal: string;
  } | null>(null);
  const [colorBusy, setColorBusy] = useState(false);

  function openColorEditor(member: FamilyMember) {
    setEditingColorsFor(member.id);
    setColorDraft(resolveQuickShiftConfig(member));
  }

  async function saveColors(memberId: string) {
    if (!colorDraft) return;
    setColorBusy(true);
    try {
      await apiFetch(`/api/family-members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify(colorDraft),
      });
      setEditingColorsFor(null);
      setColorDraft(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setColorBusy(false);
    }
  }

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
        <div key={m.id}>
          <div className="row">
            <MemberAvatar icon={m.icon} colorToken={m.colorToken} />
            <div style={{ flex: 1 }}>
              <div className="row-title">{m.name}</div>
              <div className="row-sub">
                {m.kind === "PARENT" ? "Parent" : "Child"}
                {m.requiredWeeklyMinutes ? ` · ${(m.requiredWeeklyMinutes / 60).toFixed(1)}h/week` : ""}
              </div>
            </div>
            {m.kind === "PARENT" && (
              <button
                className="btn btn-ghost"
                aria-label={`${m.name}'s day/night colours`}
                style={{ minHeight: "auto", padding: 8 }}
                onClick={() => (editingColorsFor === m.id ? setEditingColorsFor(null) : openColorEditor(m))}
              >
                <Palette size={16} />
              </button>
            )}
          </div>

          {editingColorsFor === m.id && colorDraft && (
            <div style={{ padding: "10px 0 16px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
              <p style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 10 }}>
                The colour and time the Month calendar&apos;s quick-fill tool uses for {m.name}&apos;s Day and Night
                shifts.
              </p>
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Day colour</label>
                  <input
                    type="color"
                    value={colorDraft.dayColor}
                    onChange={(e) => setColorDraft({ ...colorDraft, dayColor: e.target.value })}
                    style={{ width: "100%", height: 40, border: "1px solid var(--line)", borderRadius: 8, padding: 2 }}
                  />
                </div>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Night colour</label>
                  <input
                    type="color"
                    value={colorDraft.nightColor}
                    onChange={(e) => setColorDraft({ ...colorDraft, nightColor: e.target.value })}
                    style={{ width: "100%", height: 40, border: "1px solid var(--line)", borderRadius: 8, padding: 2 }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Day start</label>
                  <input type="time" value={colorDraft.dayStartLocal} onChange={(e) => setColorDraft({ ...colorDraft, dayStartLocal: e.target.value })} />
                </div>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Day end</label>
                  <input type="time" value={colorDraft.dayEndLocal} onChange={(e) => setColorDraft({ ...colorDraft, dayEndLocal: e.target.value })} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Night start</label>
                  <input type="time" value={colorDraft.nightStartLocal} onChange={(e) => setColorDraft({ ...colorDraft, nightStartLocal: e.target.value })} />
                </div>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Night end</label>
                  <input type="time" value={colorDraft.nightEndLocal} onChange={(e) => setColorDraft({ ...colorDraft, nightEndLocal: e.target.value })} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => { setEditingColorsFor(null); setColorDraft(null); }}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={colorBusy} onClick={() => saveColors(m.id)}>
                  {colorBusy ? "Saving…" : "Save colours"}
                </button>
              </div>
            </div>
          )}
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
