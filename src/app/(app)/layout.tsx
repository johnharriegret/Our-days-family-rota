"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, LogOut, Plus, Settings2 } from "lucide-react";
import { AddSheet } from "@/components/AddSheet";
import { InstallAppButton } from "@/components/InstallAppButton";
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
  { href: "/month", label: "Calendar", icon: CalendarDays },
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
        <div className="header-tools">
          <InstallAppButton />
          <button className="header-action" onClick={logout} aria-label="Sign out">
            <LogOut size={17} /> <span>Sign out</span>
          </button>
        </div>
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
