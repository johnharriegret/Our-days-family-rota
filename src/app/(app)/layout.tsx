"use client";

import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, LogOut, Plus, Settings2 } from "lucide-react";
import { InstallAppButton } from "@/components/InstallAppButton";
import { apiFetch } from "@/lib/client";

const TABS = [
  { href: "/month", label: "Calendar", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

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
        {/* The same quick add tool as Month's "Quick add" action - this just
            jumps there (via ?quickAdd=1, which the Month page opens then
            clears) so it works as a shortcut from Settings too. */}
        <button type="button" className="tab-bar-add" onClick={() => router.push("/month?quickAdd=1")} aria-label="Quick add to the calendar">
          <span className="tab-bar-add-icon"><Plus size={19} /></span>
          Add
        </button>
      </nav>
    </div>
  );
}
