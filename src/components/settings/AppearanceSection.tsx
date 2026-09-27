"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

export function AppearanceSection({
  initialTogetherColor,
  onChanged,
}: {
  /** Already loaded by the Settings page - no fetch needed on mount. */
  initialTogetherColor: string;
  /** Called after saving, so the Settings page's own bootstrap stays in sync. */
  onChanged: () => void;
}) {
  const [color, setColor] = useState(initialTogetherColor);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setColor(initialTogetherColor);
  }, [initialTogetherColor]);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await apiFetch("/api/settings/appearance", {
        method: "PATCH",
        body: JSON.stringify({ togetherColor: color }),
      });
      setSaved(true);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Appearance</h2>
      <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 14 }}>
        The highlight colour for a day both parents are off, on the Month and Week views — the same way
        each parent&apos;s Day/Night shift colours can be customised above.
      </p>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>Days off together colour</label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ width: "100%", height: 40, border: "1px solid var(--line)", borderRadius: 8, padding: 2 }}
        />
      </div>
      {saved && <div className="pill pill-good" style={{ marginBottom: 12 }}>Saved</div>}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save colour"}
      </button>
    </div>
  );
}
