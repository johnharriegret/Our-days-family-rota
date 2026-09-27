"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/client";
import type { FamilyMember } from "@/lib/clientTypes";

type Block = { kind: string; count: number; startLocal: string | null; endLocal: string | null };
type Pattern = { anchor: string; blocks: Block[] } | null;

const PRESET_DDDD_NNNN: Block[] = [
  { kind: "D", count: 4, startLocal: "06:00", endLocal: "18:00" },
  { kind: "O", count: 4, startLocal: null, endLocal: null },
  { kind: "D", count: 4, startLocal: "06:00", endLocal: "18:00" },
  { kind: "O", count: 4, startLocal: null, endLocal: null },
  { kind: "N", count: 4, startLocal: "18:00", endLocal: "06:00" },
  { kind: "O", count: 4, startLocal: null, endLocal: null },
];

export function PatternEditorSection({
  parents,
  initialPatternsByOwnerId,
}: {
  parents: FamilyMember[];
  /** Every parent's current pattern, already loaded by the Settings page -
   * looked up locally instead of a fetch per owner, including when the
   * dropdown switches to a different parent (no round trip needed either way). */
  initialPatternsByOwnerId: Record<string, Pattern>;
}) {
  const [ownerId, setOwnerId] = useState(parents[0]?.id ?? "");
  const [anchor, setAnchor] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ownerId) return;
    const pattern = initialPatternsByOwnerId[ownerId] ?? null;
    setAnchor(pattern?.anchor ?? "");
    setBlocks(pattern?.blocks ?? []);
    setSaved(false);
  }, [ownerId, initialPatternsByOwnerId]);

  function updateBlock(index: number, patch: Partial<Block>) {
    setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }
  function removeBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }
  function addBlock() {
    setBlocks((prev) => [...prev, { kind: "D", count: 1, startLocal: "06:00", endLocal: "18:00" }]);
  }

  async function save() {
    if (!anchor || blocks.length === 0) return setError("Set an anchor date and at least one block");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/patterns", {
        method: "POST",
        body: JSON.stringify({ ownerId, anchor, blocks }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (parents.length === 0) return null;

  return (
    <div className="card">
      <h2>Repeating work rota</h2>
      {parents.length > 1 && (
        <div className="field">
          <label>Whose rota?</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>Cycle starts from (anchor date)</label>
        <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
      </div>

      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="pill pill-good" style={{ marginBottom: 12 }}>Saved</div>}

      {blocks.map((block, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
          <div className="field" style={{ flex: "0 0 70px", marginBottom: 0 }}>
            <label>Kind</label>
            <input value={block.kind} onChange={(e) => updateBlock(i, { kind: e.target.value.toUpperCase() })} />
          </div>
          <div className="field" style={{ flex: "0 0 60px", marginBottom: 0 }}>
            <label>Days</label>
            <input
              type="number"
              min={1}
              value={block.count}
              onChange={(e) => updateBlock(i, { count: Number(e.target.value) })}
            />
          </div>
          {block.kind !== "O" && (
            <>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>Start</label>
                <input
                  type="time"
                  value={block.startLocal ?? ""}
                  onChange={(e) => updateBlock(i, { startLocal: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>End</label>
                <input
                  type="time"
                  value={block.endLocal ?? ""}
                  onChange={(e) => updateBlock(i, { endLocal: e.target.value })}
                />
              </div>
            </>
          )}
          <button className="btn btn-ghost" onClick={() => removeBlock(i)} aria-label="Remove block" style={{ padding: 10, minHeight: "auto" }}>
            <Trash2 size={18} />
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={addBlock}>
          + Add block
        </button>
        {blocks.length === 0 && (
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setBlocks(PRESET_DDDD_NNNN)}>
            Use 4-on/4-off preset
          </button>
        )}
      </div>

      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
        Save rota
      </button>
      <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 10 }}>
        Saving replaces the whole cycle from today onward — it never rewrites history, so past days on the calendar
        stay exactly as they were.
      </p>
    </div>
  );
}
