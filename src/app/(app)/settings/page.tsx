"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { FamilyMembersSection } from "@/components/settings/FamilyMembersSection";
import { PatternEditorSection } from "@/components/settings/PatternEditorSection";
import { ShiftTypesSection } from "@/components/settings/ShiftTypesSection";
import { SchoolsSection } from "@/components/settings/SchoolsSection";
import { ChildcareRuleSection } from "@/components/settings/ChildcareRuleSection";
import type { FamilyMember } from "@/lib/clientTypes";

export default function SettingsPage() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([
      apiFetch<{ members: FamilyMember[] }>("/api/family-members"),
      apiFetch<{ schools: { id: string; name: string }[] }>("/api/schools"),
    ]);
    setMembers(m.members);
    setSchools(s.schools);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const parents = members.filter((m) => m.kind === "PARENT");

  if (loading) return <div className="page-body empty-state">Loading…</div>;

  return (
    <div className="page-body">
      <FamilyMembersSection members={members} schools={schools} onChanged={load} />
      <PatternEditorSection parents={parents} />
      <ShiftTypesSection parents={parents} />
      <SchoolsSection />
      <ChildcareRuleSection />
    </div>
  );
}
