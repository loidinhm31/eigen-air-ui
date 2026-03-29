import * as React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { MessageSquare, Brain, Wrench, BookOpen, Settings, History } from "lucide-react";
import { StatusBadge } from "../molecules/StatusBadge.js";
import { cn } from "@nonclaw-ui/shared/utils";

const NAV_ITEMS = [
  { to: "", icon: MessageSquare, label: "Chat" },
  { to: "memory", icon: Brain, label: "Memory" },
  { to: "tools", icon: Wrench, label: "Tools" },
  { to: "skills", icon: BookOpen, label: "Skills" },
  { to: "sessions", icon: History, label: "Sessions" },
  { to: "settings", icon: Settings, label: "Settings" },
] as const;

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <nav className="flex w-52 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">nonclaw</span>
          <StatusBadge />
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === ""}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-4 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )
              }
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
AppShell.displayName = "AppShell";
