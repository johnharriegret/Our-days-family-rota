"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/client";

type Term = { id: string; startDate: string; endDate: string; type: string; label: string };
type School = { id: string; name: string; startLocal: string; endLocal: string; terms: Term[] };

const TERM_TYPES = [
  { value: "TERM", label: "Term" },
  { value: "HOLIDAY", label: "Holiday" },
  { value: "INSET", label: "Inset day" },
];

export function SchoolsSection() {
  const [schools, setSchools] = useState<School[]>([]);
  const [addingSchool, setAddingSchool] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [termFormFor, setTermFormFor] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState("TERM");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<{ schools: School[] }>("/api/schools").then((d) => setSchools(d.schools));
  }
  useEffect(load, []);

  async function addSchool() {
    if (!schoolName.trim()) return;
    await apiFetch("/api/schools", { method: "POST", body: JSON.stringify({ name: schoolName.trim() }) });
    setSchoolName("");
    setAddingSchool(false);
    load();
  }

  async function addTerm(schoolId: string) {
    if (!startDate || !endDate || !label.trim()) return setError("Fill in the dates and a label");
    if (startDate > endDate) return setError("Start date must be before end date");
    setError(null);
    try {
      await apiFetch(`/api/schools/${schoolId}/terms`, {
        method: "POST",
        body: JSON.stringify({ startDate, endDate, type, label: label.trim() }),
      });
      setStartDate("");
      setEndDate("");
      setLabel("");
      setTermFormFor(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  async function removeTerm(id: string) {
    await apiFetch(`/api/terms/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="card">
      <h2>Schools &amp; term dates</h2>
      {schools.map((school) => (
        <div key={school.id} style={{ marginBottom: 16 }}>
          <div className="row-title" style={{ marginBottom: 8 }}>{school.name}</div>
          {school.terms.map((t) => (
            <div className="row" key={t.id}>
              <div style={{ flex: 1 }}>
                <div className="row-title" style={{ fontSize: 14 }}>{t.label}</div>
                <div className="row-sub">
                  {t.type} {"·"} {t.startDate.slice(0, 10)} {"–"} {t.endDate.slice(0, 10)}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => removeTerm(t.id)} style={{ minHeight: "auto", padding: 8 }}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}

          {termFormFor === school.id ? (
            <div style={{ marginTop: 10 }}>
              {error && <div className="error-banner">{error}</div>}
              <div className="field">
                <label>Label</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Autumn term" />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>From</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>To</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Type</label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {TERM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setTermFormFor(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => addTerm(school.id)}>
                  Add block
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-secondary btn-block" onClick={() => setTermFormFor(school.id)}>
              + Add term/holiday block
            </button>
          )}
        </div>
      ))}

      {!addingSchool && (
        <button className="btn btn-secondary btn-block" onClick={() => setAddingSchool(true)}>
          + Add school
        </button>
      )}
      {addingSchool && (
        <div style={{ display: "flex", gap: 8 }}>
          <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="School name" style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px" }} />
          <button className="btn btn-primary" onClick={addSchool}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
