"use client";

// Weekday values use 0=Sun..6=Sat to match the scheduling engine.
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 0, label: "S" },
];

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  function toggle(day: number) {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort());
  }
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {DAYS.map((d, i) => {
        const on = value.includes(d.value);
        return (
          <button
            key={i}
            type="button"
            onClick={() => toggle(d.value)}
            aria-pressed={on}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
              background: on ? "var(--accent)" : "transparent",
              color: on ? "#fff" : "var(--muted)",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

export function weekdaysLabel(weekdays: number[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const names: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 0: "Sun" };
  const sorted = order.filter((d) => weekdays.includes(d));
  if (sorted.length === 5 && [1, 2, 3, 4, 5].every((d) => weekdays.includes(d))) return "Mon–Fri";
  return sorted.map((d) => names[d]).join(", ");
}
