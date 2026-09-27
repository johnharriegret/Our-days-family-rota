import { AlertTriangle, Clock } from "lucide-react";
import type { CalendarChildcare } from "@/lib/clientTypes";

/**
 * Shows a plain-English childcare warning for a day. Renders nothing when cover
 * is fine (SAFE) or can't be judged yet (null) - only real problems surface.
 */
export function ChildcareBanner({ childcare, compact = false }: { childcare: CalendarChildcare | null; compact?: boolean }) {
  if (!childcare || childcare.status === "SAFE") return null;
  const needed = childcare.status === "CHILDCARE_NEEDED";
  const Icon = needed ? AlertTriangle : Clock;
  return (
    <div className={`childcare-banner ${needed ? "needed" : "handover"}`}>
      <Icon size={compact ? 15 : 17} className="childcare-icon" />
      <span>{childcare.explanation}</span>
    </div>
  );
}
