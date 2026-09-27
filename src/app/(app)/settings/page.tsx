"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { FamilyMembersSection } from "@/components/settings/FamilyMembersSection";
import { PatternEditorSection } from "@/components/settings/PatternEditorSection";
import { ShiftTypesSection } from "@/components/settings/ShiftTypesSection";
import { SchoolsSection, type SchoolWithTerms } from "@/components/settings/SchoolsSection";
import { ChildcareRuleSection, type ChildcareRule } from "@/components/settings/ChildcareRuleSection";
import type { FamilyMember, ShiftType } from "@/lib/clientTypes";

type Pattern = { anchor: string; blocks: { kind: string; count: number; startLocal: string | null; endLocal: string | null }[] };

type Bootstrap = {
  members: FamilyMember[];
  schools: SchoolWithTerms[];
  childcareRule: ChildcareRule | null;
  patternsByOwnerId: Record<string, Pattern>;
  shiftTypesByOwnerId: Record<string, ShiftType[]>;
};

// Everything Settings needs, in one request - see the route's own comment for
// why (this used to be 5-6 separate API calls firing on every page open,
// each its own cold Prisma/Postgres round trip, which is what made Settings
// slow to load in practice).
export default function SettingsPage() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const bootstrap = await apiFetch<Bootstrap>("/api/settings/bootstrap");
    setData(bootstrap);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) return <div className="page-body empty-state">Loading…</div>;

  const parents = data.members.filter((m) => m.kind === "PARENT");

  return (
    <div className="page-body">
      <FamilyMembersSection members={data.members} schools={data.schools} onChanged={load} />
      <PatternEditorSection parents={parents} initialPatternsByOwnerId={data.patternsByOwnerId} />
      <ShiftTypesSection parents={parents} initialShiftTypesByOwnerId={data.shiftTypesByOwnerId} />
      <SchoolsSection initialSchools={data.schools} onChanged={load} />
      <ChildcareRuleSection initialRule={data.childcareRule} onChanged={load} />
    </div>
  );
}
