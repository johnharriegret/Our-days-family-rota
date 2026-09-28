"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import type { FamilyMember } from "@/lib/clientTypes";

export function AppearanceSection({
  initialTogetherColor,
  childMembers,
  initialHiddenCalendarChildIds,
  onChanged,
}: {
  /** Already loaded by the Settings page - no fetch needed on mount. */
  initialTogetherColor: string;
  childMembers: FamilyMember[];
  initialHiddenCalendarChildIds: string[];
  /** Called after saving, so the Settings page's own bootstrap stays in sync. */
  onChanged: () => void;
}) {
  const [color, setColor] = useState(initialTogetherColor);
  const [hiddenChildIds, setHiddenChildIds] = useState(initialHiddenCalendarChildIds);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setColor(initialTogetherColor);
    setHiddenChildIds(initialHiddenCalendarChildIds);
  }, [initialHiddenCalendarChildIds, initialTogetherColor]);

  function toggleChild(memberId: string) {
    setSaved(false);
    setHiddenChildIds((current) => current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId]);
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await apiFetch("/api/settings/appearance", {
        method: "PATCH",
        body: JSON.stringify({ togetherColor: color, hiddenCalendarChildIds: hiddenChildIds }),
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
          onChange={(e) => { setColor(e.target.value); setSaved(false); }}
          style={{ width: "100%", height: 40, border: "1px solid var(--line)", borderRadius: 8, padding: 2 }}
        />
      </div>
      <div className="appearance-marker-settings">
        <div>
          <strong>Children shown on the month calendar</strong>
          <span>Hide a child&apos;s school dot for now without deleting their school or term dates.</span>
        </div>
        <div className="marker-toggle-list">
          {childMembers.map((child) => {
            const shown = !hiddenChildIds.includes(child.id);
            return (
              <button
                key={child.id}
                type="button"
                className="marker-toggle-row"
                role="switch"
                aria-checked={shown}
                onClick={() => toggleChild(child.id)}
              >
                <span><i style={{ background: `var(--${child.colorToken})` }} />{child.name.split(" ")[0]}</span>
                <b className={shown ? "is-on" : ""}>{shown ? "Shown" : "Hidden"}</b>
              </button>
            );
          })}
        </div>
      </div>
      {saved && <div className="pill pill-good" style={{ marginBottom: 12 }}>Saved</div>}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save appearance"}
      </button>
    </div>
  );
}
