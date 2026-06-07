"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Server,
  ShieldCheck,
  KeyRound,
  BookOpen,
  ScrollText,
  Cpu,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";
import ThemeToggle from "@/app/components/theme-toggle";
import { createSupabaseBrowserClient } from "@/lib/supabase";

interface SidebarProps {
  userEmail: string;
}

function LogoutButtonInline() {
  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.replace("/login");
  };

  return (
    <button
      onClick={handleLogout}
      title="Logout"
      className="flex items-center justify-center rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}

export default function DashboardSidebar({
  userEmail,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  function isActive(href: string, exact = false) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  const navItems = [
    {
      label: "Instances",
      href: "/dashboard",
      icon: Server,
      exact: true,
    },
    {
      label: "Environment Variables",
      href: "/dashboard/configs",
      icon: ShieldCheck,
    },
    {
      label: "API Keys",
      href: "/dashboard/settings/keys",
      icon: KeyRound,
    },
    {
      label: "Activity Logs",
      href: "/dashboard/system/logs",
      icon: ScrollText,
    },
    {
      label: "Cluster Health",
      href: "/dashboard/system/health",
      icon: Cpu,
    },
    {
      label: "Documentation",
      href: "/docs",
      icon: BookOpen,
    },
  ];

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 transition-[width] duration-200 ease-in-out ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Brand + collapse toggle */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-3 dark:border-gray-700">
        {!collapsed && (
          <span className="truncate text-base font-bold text-gray-900 dark:text-white">
            OCL<span className="text-blue-600 dark:text-blue-400"> Nexus Local</span>
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200 ${
            collapsed ? "mx-auto" : "ml-auto"
          }`}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {navItems.map((item) => {
          const active = isActive(item.href, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {(item as { badge?: string | null }).badge && (
                    <span className="text-xs font-medium tabular-nums text-gray-400 dark:text-gray-500">
                      {(item as { badge?: string | null }).badge}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom: user + actions */}
      <div className="shrink-0 border-t border-gray-200 p-2 dark:border-gray-700">
        {!collapsed && (
          <p className="mb-1.5 truncate px-1 text-xs text-gray-400 dark:text-gray-500">
            {userEmail}
          </p>
        )}
        <div
          className={`flex items-center gap-1 ${collapsed ? "flex-col" : "justify-end"}`}
        >
          <ThemeToggle />
          <LogoutButtonInline />
        </div>
      </div>
    </aside>
  );
}
