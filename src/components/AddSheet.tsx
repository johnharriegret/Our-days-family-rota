"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { MemberAvatar } from "./memberIcon";
import type { FamilyMember, ShiftType } from "@/lib/clientTypes";

type EventCategory = "APPOINTMENT" | "ACTIVITY" | "HOLIDAY" | "OTHER";

const EVENT_TYPES: { value: EventCategory; label: string }[] = [
  { value: "APPOINTMENT", label: "Appointment" },
  { value: "ACTIVITY", label: "Activity" },
  { value: "HOLIDAY", label: "Annual leave" },
  { value: "OTHER", label: "Other" },
];

export function AddSheet({
  defaultDate,
  onClose,
  onSaved,
}: {
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [selected, setSelected] = useState<FamilyMember | "FAMILY" | null>(null);
  const [mode, setMode] = useState<"WORK" | "OFF" | EventCategory | null>(null);
  const [date, setDate] = useState(defaultDate);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [customStart, setCustomStart] = useState("06:00");
  const [customEnd, setCustomEnd] = useState("18:00");
  const [customPaidMinutes, setCustomPaidMinutes] = useState(480);
  const [title, setTitle] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ members: FamilyMember[] }>("/api/family-members").then((d) => setMembers(d.members));
  }, []);

  useEffect(() => {
    if (selected && selected !== "FAMILY" && selected.kind === "PARENT" && mode === "WORK") {
      apiFetch<{ types: ShiftType[] }>(`/api/shift-types?ownerId=${selected.id}`).then((d) =>
        setShiftTypes(d.types),
      );
    }
  }, [selected, mode]);

  function reset() {
    setSelected(null);
    setMode(null);
    setShowCustom(false);
    setTitle("");
    setStartLocal("");
    setEndLocal("");
    setError(null);
  }

  async function saveShift(shiftTypeId: string | null, customFields?: { start: string; end: string; paidMinutes: number }) {
    if (!selected || selected === "FAMILY") return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/shifts", {
        method: "POST",
        body: JSON.stringify({
          ownerId: selected.id,
          date,
          shiftTypeId,
          customStart: customFields?.start ?? null,
          customEnd: customFields?.end ?? null,
          paidMinutes: customFields?.paidMinutes ?? null,
        }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function saveOff() {
    if (!selected || selected === "FAMILY") return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/shifts", {
        method: "POST",
        body: JSON.stringify({ ownerId: selected.id, date, shiftTypeId: null, customStart: null, customEnd: null }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function saveEvent(category: EventCategory) {
    if (!title.trim()) {
      setError("Give it a short title");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          memberIds: selected === "FAMILY" || !selected ? [] : [selected.id],
          date,
          startLocal: startLocal || null,
          endLocal: endLocal || null,
          category,
        }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <strong style={{ fontSize: 17 }}>Add to the calendar</strong>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ padding: 8, minHeight: "auto" }}>
            <X size={22} />
          </button>
        </div>

        <div className="field">
          <label htmlFor="add-date">Date</label>
          <input id="add-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {error && <div className="error-banner">{error}</div>}

        {!selected && (
          <>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>Who&apos;s this for?</label>
            <div className="choice-grid" style={{ marginTop: 10 }}>
              {members.map((m) => (
                <button key={m.id} className="choice-btn" onClick={() => setSelected(m)}>
                  <MemberAvatar icon={m.icon} colorToken={m.colorToken} size={22} />
                  {m.name}
                </button>
              ))}
              <button className="choice-btn" onClick={() => setSelected("FAMILY")}>
                <div className="avatar member-family">
                  <span style={{ fontSize: 18 }}>👨‍👩‍👧‍👦</span>
                </div>
                Whole family
              </button>
            </div>
          </>
        )}

        {selected && !mode && (
          <>
            <button className="btn btn-ghost" onClick={reset} style={{ padding: 0, marginBottom: 12, minHeight: "auto" }}>
              ← Change person
            </button>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>What kind of thing?</label>
            <div className="choice-grid" style={{ marginTop: 10 }}>
              {selected !== "FAMILY" && selected.kind === "PARENT" && (
                <>
                  <button className="choice-btn" onClick={() => setMode("WORK")}>Work</button>
                  <button className="choice-btn" onClick={() => setMode("OFF")}>Off</button>
                </>
              )}
              {EVENT_TYPES.map((t) => (
                <button key={t.value} className="choice-btn" onClick={() => setMode(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </>
        )}

        {mode === "WORK" && selected !== "FAMILY" && selected && (
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setMode(null)}
              style={{ padding: 0, marginBottom: 12, minHeight: "auto" }}
            >
              ← Back
            </button>
            {!showCustom && (
              <div className="choice-grid">
                {shiftTypes.map((t) => (
                  <button key={t.id} className="choice-btn" disabled={busy} onClick={() => saveShift(t.id)}>
                    {t.name}
                  </button>
                ))}
                <button className="choice-btn" onClick={() => setShowCustom(true)}>
                  Custom…
                </button>
              </div>
            )}
            {showCustom && (
              <div>
                <div className="field">
                  <label>Start</label>
                  <input type="time" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                </div>
                <div className="field">
                  <label>End</label>
                  <input type="time" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                </div>
                <div className="field">
                  <label>Paid minutes</label>
                  <input
                    type="number"
                    value={customPaidMinutes}
                    onChange={(e) => setCustomPaidMinutes(Number(e.target.value))}
                  />
                </div>
                <button
                  className="btn btn-primary btn-block"
                  disabled={busy}
                  onClick={() =>
                    saveShift(null, { start: customStart, end: customEnd, paidMinutes: customPaidMinutes })
                  }
                >
                  Save shift
                </button>
              </div>
            )}
          </>
        )}

        {mode === "OFF" && (
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setMode(null)}
              style={{ padding: 0, marginBottom: 12, minHeight: "auto" }}
            >
              ← Back
            </button>
            <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 14 }}>
              Mark {selected !== "FAMILY" ? selected?.name : ""} as off on {date}.
            </p>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy} onClick={saveOff}>
              Confirm off
            </button>
          </>
        )}

        {mode && mode !== "WORK" && mode !== "OFF" && (
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setMode(null)}
              style={{ padding: 0, marginBottom: 12, minHeight: "auto" }}
            >
              ← Back
            </button>
            <div className="field">
              <label htmlFor="title">Title</label>
              <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Start (optional)</label>
                <input type="time" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>End (optional)</label>
                <input type="time" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
              </div>
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy}
              onClick={() => saveEvent(mode as EventCategory)}
            >
              Save
            </button>
          </>
        )}
      </div>
    </div>
  );
}
