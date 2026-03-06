import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSidebarOrder } from "@/hooks/useSidebarOrder";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getPlatform } from "@/lib/platform";
import {
  LayoutDashboard,
  Clock,
  Link2,
  Settings,
  FileText,
  Terminal,
  GitPullRequestArrow,
  Zap,
} from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/history", icon: Clock, label: "History" },
  { to: "/claude-code", icon: Terminal, label: "Claude Code" },
  { to: "/pr-review", icon: GitPullRequestArrow, label: "PR Review" },
  { to: "/commands", icon: Zap, label: "Commands" },
  { to: "/connections", icon: Link2, label: "Connections" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/reports", icon: FileText, label: "Reports" },
];

export function Sidebar() {
  const { orderItems, isVisible } = useSidebarOrder();
  const [isMac, setIsMac] = useState(true); // default true to avoid layout shift on macOS
  useEffect(() => { getPlatform().then((p) => setIsMac(p === "macos")); }, []);

  const orderedItems = orderItems(navItems, (i) => i.to);

  const visibleItems = orderedItems.filter((item) =>
    item.to === "/settings" || isVisible(item.to)
  );

  return (
    <aside className="w-[220px] h-screen flex flex-col border-r bg-sidebar-background shrink-0">
      {/* Drag region for macOS overlay titlebar */}
      {isMac && (
        <div
          onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().startDragging(); }}
          className="h-8 shrink-0"
        />
      )}
      {/* App branding */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b">
        <img src="/app-icon.png" alt="" className="h-6 w-6 rounded" />
        <span className="text-sm font-semibold text-sidebar-primary">DevPulse</span>
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50",
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t">
        <p className="text-[10px] text-muted-foreground text-center">
          DevPulse v0.1.0
        </p>
      </div>
    </aside>
  );
}
