"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Calendar, CalendarDays, Plus, Settings2, Sun } from "lucide-react";
import { AddSheet } from "@/components/AddSheet";
import { apiFetch } from "@/lib/client";
import { emitCalendarChanged } from "@/lib/refresh";

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const TABS = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/week", label: "Week", icon: Calendar },
  { href: "/month", label: "Month", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div className="brand">
          <div className="brand-mark">☀️</div>
          Our Days
        </div>
        <button className="btn btn-ghost" onClick={logout} style={{ padding: "6px 10px", minHeight: "auto", fontSize: 13 }}>
          Sign out
        </button>
      </div>

      {children}

      <button className="fab" onClick={() => setShowAdd(true)} aria-label="Add to the calendar">
        <Plus size={28} />
      </button>

      {showAdd && (
        <AddSheet
          defaultDate={todayStr()}
          onClose={() => setShowAdd(false)}
          onSaved={() => emitCalendarChanged()}
        />
      )}

      <nav className="tab-bar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = pathname === t.href;
          return (
            <a key={t.href} href={t.href} className={active ? "active" : ""}>
              <Icon size={20} />
              {t.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
