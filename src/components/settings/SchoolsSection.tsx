"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { WeekdayPicker, weekdaysLabel } from "@/components/WeekdayPicker";
import { parseSchoolCalendarText, type ParsedBlockType } from "@/lib/schoolImport";

type Term = { id: string; startDate: string; endDate: string; type: string; label: string; weekdays: number[] };
type School = { id: string; name: string; startLocal: string; endLocal: string; terms: Term[] };

const TERM_TYPES = [
  { value: "TERM", label: "Term (school days)" },
  { value: "HOLIDAY", label: "Holiday / half term" },
  { value: "INSET", label: "INSET / training day" },
];

const MON_FRI = [1, 2, 3, 4, 5];

type ReviewBlock = {
  label: string;
  type: ParsedBlockType;
  startDate: string;
  endDate: string;
  weekdays: number[];
  confidence: "high" | "review";
};

export function SchoolsSection() {
  const [schools, setSchools] = useState<School[]>([]);
  const [addingSchool, setAddingSchool] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [schoolStart, setSchoolStart] = useState("08:45");
  const [schoolEnd, setSchoolEnd] = useState("15:15");

  // manual term form
  const [termFormFor, setTermFormFor] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState<ParsedBlockType>("TERM");
  const [label, setLabel] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>(MON_FRI);
  const [error, setError] = useState<string | null>(null);

  // importer
  const [importFor, setImportFor] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [ayStart, setAyStart] = useState(new Date().getFullYear());
  const [review, setReview] = useState<ReviewBlock[] | null>(null);
  const [unrecognised, setUnrecognised] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function load() {
    apiFetch<{ schools: School[] }>("/api/schools").then((d) => setSchools(d.schools));
  }
  useEffect(load, []);

  async function addSchool() {
    if (!schoolName.trim()) return;
    await apiFetch("/api/schools", {
      method: "POST",
      body: JSON.stringify({ name: schoolName.trim(), startLocal: schoolStart, endLocal: schoolEnd }),
    });
    setSchoolName("");
    setSchoolStart("08:45");
    setSchoolEnd("15:15");
    setAddingSchool(false);
    load();
  }

  async function addTerm(schoolId: string) {
    if (!startDate || !endDate || !label.trim()) return setError("Fill in the dates and a label");
    if (startDate > endDate) return setError("Start date must be before end date");
    setError(null);
    await apiFetch(`/api/schools/${schoolId}/terms`, {
      method: "POST",
      body: JSON.stringify({ startDate, endDate, type, label: label.trim(), weekdays: type === "TERM" ? weekdays : MON_FRI }),
    });
    setStartDate("");
    setEndDate("");
    setLabel("");
    setWeekdays(MON_FRI);
    setType("TERM");
    setTermFormFor(null);
    load();
  }

  async function removeTerm(id: string) {
    await apiFetch(`/api/terms/${id}`, { method: "DELETE" });
    load();
  }

  function analyse() {
    const result = parseSchoolCalendarText(importText, { academicYearStart: ayStart });
    setUnrecognised(result.unrecognised);
    setReview(result.blocks.map((b) => ({ ...b, weekdays: MON_FRI })));
  }

  async function confirmImport(schoolId: string) {
    if (!review || review.length === 0) return;
    setBusy(true);
    try {
      await apiFetch(`/api/schools/${schoolId}/terms`, {
        method: "POST",
        body: JSON.stringify({
          blocks: review.map((b) => ({
            startDate: b.startDate,
            endDate: b.endDate,
            type: b.type,
            label: b.label,
            weekdays: b.type === "TERM" ? b.weekdays : MON_FRI,
          })),
        }),
      });
      setImportFor(null);
      setImportText("");
      setReview(null);
      setUnrecognised([]);
      load();
    } finally {
      setBusy(false);
    }
  }

  function updateReview(i: number, patch: Partial<ReviewBlock>) {
    setReview((prev) => (prev ? prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) : prev));
  }

  return (
    <div className="card">
      <h2>Schools &amp; term dates</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -4, marginBottom: 12 }}>
        Enter term dates as a few date ranges — every weekday inside a term becomes a school day automatically.
        A nursery or part-time place can be set to only certain weekdays.
      </p>

      {schools.map((school) => (
        <div key={school.id} style={{ marginBottom: 18 }}>
          <div className="row-title" style={{ marginBottom: 2 }}>{school.name}</div>
          <div className="row-sub" style={{ marginBottom: 8 }}>{school.startLocal}–{school.endLocal}</div>

          {school.terms.map((t) => (
            <div className="row" key={t.id}>
              <div style={{ flex: 1 }}>
                <div className="row-title" style={{ fontSize: 14 }}>{t.label}</div>
                <div className="row-sub">
                  {t.type} {"·"} {t.startDate.slice(0, 10)} {"–"} {t.endDate.slice(0, 10)}
                  {t.type === "TERM" && t.weekdays && weekdaysLabel(t.weekdays) !== "Mon–Fri" ? ` · ${weekdaysLabel(t.weekdays)}` : ""}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => removeTerm(t.id)} aria-label={`Remove ${t.label}`} style={{ minHeight: "auto", padding: 8 }}>
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
                <select value={type} onChange={(e) => setType(e.target.value as ParsedBlockType)}>
                  {TERM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              {type === "TERM" && (
                <div className="field">
                  <label>Which days? (e.g. nursery Tue/Wed/Thu)</label>
                  <WeekdayPicker value={weekdays} onChange={setWeekdays} />
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setTermFormFor(null)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => addTerm(school.id)}>Add block</button>
              </div>
            </div>
          ) : importFor === school.id ? (
            <div style={{ marginTop: 10 }}>
              {!review ? (
                <>
                  <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 8 }}>
                    Paste or type the school&apos;s term dates. It reads lines like &quot;School opens – 7 September 2026&quot; and
                    &quot;Break up – 23 October 2026&quot;, or a range like &quot;Autumn term: 2 Sep to 24 Oct&quot;.
                  </p>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={7}
                    placeholder={"School opens - Monday 7 September 2026\nBreak up - Friday 23 October 2026\nHalf term - 26 to 30 October 2026\nINSET day - 2 September 2026"}
                    style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "inherit" }}
                  />
                  <div className="field" style={{ marginTop: 8 }}>
                    <label>Academic year starts (used only if the sheet omits the year)</label>
                    <input type="number" value={ayStart} onChange={(e) => setAyStart(Number(e.target.value))} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost" onClick={() => { setImportFor(null); setImportText(""); }}>Cancel</button>
                    <button className="btn btn-primary" style={{ flex: 1 }} disabled={!importText.trim()} onClick={analyse}>Analyse dates</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>We found these dates — check before importing</div>
                  {review.length === 0 && <div className="error-banner">Couldn&apos;t read any dates. Try the manual form instead.</div>}
                  {review.map((b, i) => (
                    <div key={i} className="plan-card" style={{ padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                        <input value={b.label} onChange={(e) => updateReview(i, { label: e.target.value })} style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 8px", fontWeight: 700 }} />
                        <button className="btn btn-ghost" aria-label="Remove" style={{ minHeight: "auto", padding: 6 }} onClick={() => setReview((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev))}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                      {b.confidence === "review" && (
                        <div className="childcare-banner handover" style={{ marginTop: 0, marginBottom: 6 }}>Review recommended — please check this one.</div>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <div className="field" style={{ flex: 1, marginBottom: 6 }}>
                          <label>From</label>
                          <input type="date" value={b.startDate} onChange={(e) => updateReview(i, { startDate: e.target.value })} />
                        </div>
                        <div className="field" style={{ flex: 1, marginBottom: 6 }}>
                          <label>To</label>
                          <input type="date" value={b.endDate} onChange={(e) => updateReview(i, { endDate: e.target.value })} />
                        </div>
                      </div>
                      <div className="field" style={{ marginBottom: 6 }}>
                        <label>Type</label>
                        <select value={b.type} onChange={(e) => updateReview(i, { type: e.target.value as ParsedBlockType })}>
                          {TERM_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                        </select>
                      </div>
                      {b.type === "TERM" && (
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Which days?</label>
                          <WeekdayPicker value={b.weekdays} onChange={(v) => updateReview(i, { weekdays: v })} />
                        </div>
                      )}
                    </div>
                  ))}
                  {unrecognised.length > 0 && (
                    <div className="setup-banner" style={{ fontSize: 13 }}>
                      Couldn&apos;t read {unrecognised.length} line(s): {unrecognised.slice(0, 3).join("; ")}
                      {unrecognised.length > 3 ? "…" : ""}. Add those with the manual form.
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost" onClick={() => setReview(null)}>Back</button>
                    <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || review.length === 0} onClick={() => confirmImport(school.id)}>
                      {busy ? "Importing…" : `Confirm & import ${review.length}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setImportFor(school.id); setReview(null); }}>
                📋 Import from text
              </button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setTermFormFor(school.id)}>
                + Add block
              </button>
            </div>
          )}
        </div>
      ))}

      {!addingSchool && (
        <button className="btn btn-secondary btn-block" onClick={() => setAddingSchool(true)}>
          + Add school or nursery
        </button>
      )}
      {addingSchool && (
        <div style={{ marginTop: 8 }}>
          <div className="field">
            <label>Name</label>
            <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="e.g. Watcombe Primary" autoFocus />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Day starts</label>
              <input type="time" value={schoolStart} onChange={(e) => setSchoolStart(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Day ends</label>
              <input type="time" value={schoolEnd} onChange={(e) => setSchoolEnd(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setAddingSchool(false)}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={addSchool}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
