"use client";

import { useState } from "react";
import { KeyRound, Palette, Pencil } from "lucide-react";
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

  // Give an existing family member their own sign-in, separate from whoever
  // ran /setup.
  const [editingLoginFor, setEditingLoginFor] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  function openLoginEditor(member: FamilyMember) {
    setEditingLoginFor(member.id);
    setLoginEmail("");
    setLoginPassword("");
    setLoginError(null);
  }

  async function saveLogin(member: FamilyMember) {
    if (!loginEmail.trim() || !loginPassword) return setLoginError("An email and password are required");
    if (loginPassword.length < 8) return setLoginError("Password must be at least 8 characters");
    setLoginBusy(true);
    setLoginError(null);
    try {
      await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({ familyMemberId: member.id, email: loginEmail.trim(), password: loginPassword }),
      });
      setEditingLoginFor(null);
      setLoginEmail("");
      setLoginPassword("");
      onChanged();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoginBusy(false);
    }
  }

  async function removeLogin(member: FamilyMember) {
    if (!member.login) return;
    setLoginBusy(true);
    try {
      await apiFetch(`/api/users/${member.login.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setLoginBusy(false);
    }
  }

  // Edit an existing member's own details: name, and (child) date of birth /
  // school, or (parent) hard weekly hours requirement. Everything about a
  // person that was only ever settable when they were first added.
  const [editingDetailsFor, setEditingDetailsFor] = useState<string | null>(null);
  const [detailsDraft, setDetailsDraft] = useState<{
    name: string;
    dateOfBirth: string;
    schoolId: string;
    requiredWeeklyMinutes: string;
  } | null>(null);
  const [detailsBusy, setDetailsBusy] = useState(false);

  function openDetailsEditor(member: FamilyMember) {
    setEditingDetailsFor(member.id);
    setDetailsDraft({
      name: member.name,
      dateOfBirth: member.dateOfBirth ? member.dateOfBirth.slice(0, 10) : "",
      schoolId: member.schoolId ?? "",
      requiredWeeklyMinutes: member.requiredWeeklyMinutes ? String(member.requiredWeeklyMinutes / 60) : "",
    });
    setError(null);
  }

  async function saveDetails(member: FamilyMember) {
    if (!detailsDraft) return;
    if (!detailsDraft.name.trim()) return setError("Name can't be empty");
    setDetailsBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/family-members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: detailsDraft.name.trim(),
          ...(member.kind === "CHILD" && {
            dateOfBirth: detailsDraft.dateOfBirth || null,
            schoolId: detailsDraft.schoolId || null,
          }),
          ...(member.kind === "PARENT" && {
            requiredWeeklyMinutes: detailsDraft.requiredWeeklyMinutes
              ? Math.round(Number(detailsDraft.requiredWeeklyMinutes) * 60)
              : null,
          }),
        }),
      });
      setEditingDetailsFor(null);
      setDetailsDraft(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDetailsBusy(false);
    }
  }

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
                {m.login ? ` · Signs in as ${m.login.email}` : ""}
              </div>
            </div>
            <button
              className="btn btn-ghost"
              aria-label={`Edit ${m.name}'s details`}
              style={{ minHeight: "auto", padding: 8 }}
              onClick={() => (editingDetailsFor === m.id ? setEditingDetailsFor(null) : openDetailsEditor(m))}
            >
              <Pencil size={16} />
            </button>
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
            {!m.login && (
              <button
                className="btn btn-ghost"
                aria-label={`Give ${m.name} their own login`}
                style={{ minHeight: "auto", padding: 8 }}
                onClick={() => (editingLoginFor === m.id ? setEditingLoginFor(null) : openLoginEditor(m))}
              >
                <KeyRound size={16} />
              </button>
            )}
          </div>

          {editingLoginFor === m.id && (
            <div style={{ padding: "10px 0 16px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
              {loginError && <div className="error-banner">{loginError}</div>}
              <p style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 10 }}>
                Give {m.name} their own sign-in, separate from yours, so they can open Our Days on their own
                phone.
              </p>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="e.g. jeanicar@example.com"
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Password (at least 8 characters)</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="They can be given this to sign in with"
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => { setEditingLoginFor(null); setLoginError(null); }}>
                  Cancel
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={loginBusy} onClick={() => saveLogin(m)}>
                  {loginBusy ? "Saving…" : "Create login"}
                </button>
              </div>
            </div>
          )}

          {m.login && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <button
                className="btn btn-ghost"
                style={{ minHeight: "auto", padding: "4px 8px", fontSize: 12.5, color: "var(--bad)" }}
                disabled={loginBusy}
                onClick={() => removeLogin(m)}
              >
                Remove login
              </button>
            </div>
          )}

          {editingDetailsFor === m.id && detailsDraft && (
            <div style={{ padding: "10px 0 16px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
              {error && <div className="error-banner">{error}</div>}
              <div className="field">
                <label>Name</label>
                <input
                  value={detailsDraft.name}
                  onChange={(e) => setDetailsDraft({ ...detailsDraft, name: e.target.value })}
                  autoFocus
                />
              </div>
              {m.kind === "CHILD" && (
                <>
                  <div className="field">
                    <label>Date of birth</label>
                    <input
                      type="date"
                      value={detailsDraft.dateOfBirth}
                      onChange={(e) => setDetailsDraft({ ...detailsDraft, dateOfBirth: e.target.value })}
                    />
                  </div>
                  {schools.length > 0 && (
                    <div className="field">
                      <label>School</label>
                      <select
                        value={detailsDraft.schoolId}
                        onChange={(e) => setDetailsDraft({ ...detailsDraft, schoolId: e.target.value })}
                      >
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
              {m.kind === "PARENT" && (
                <div className="field">
                  <label>Hard weekly hours requirement (blank = none)</label>
                  <input
                    type="number"
                    step="0.5"
                    placeholder="e.g. 36"
                    value={detailsDraft.requiredWeeklyMinutes}
                    onChange={(e) => setDetailsDraft({ ...detailsDraft, requiredWeeklyMinutes: e.target.value })}
                  />
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => { setEditingDetailsFor(null); setDetailsDraft(null); setError(null); }}>
                  Cancel
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={detailsBusy} onClick={() => saveDetails(m)}>
                  {detailsBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}

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
