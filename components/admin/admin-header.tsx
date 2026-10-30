"use client";

import * as React from "react";
import Link from "next/link";
import {
  ShieldAlert,
  LogOut,
  LayoutDashboard,
} from "lucide-react";
import { staffSignOutAction, portalSignOutToHomeAction } from "@/lib/staff/actions";

interface AdminHeaderProps {
  email?: string | null;
}

export function AdminHeader({
  email,
}: AdminHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Left: Branding & Admin Title (Clicks sign out and return to public home) */}
          <div className="flex items-center gap-3">
            <form action={portalSignOutToHomeAction} className="inline-flex">
              <button
                type="submit"
                title="Return to Namma Bakery public website (signs out)"
                className="group flex flex-col text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel rounded-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-heading text-lg font-bold tracking-tight text-foreground group-hover:text-caramel transition-colors">
                    Namma Bakery
                  </span>
                  <span className="rounded-sm border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                    Admin Portal
                  </span>
                </div>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  Store Operations, Catalog & Administration · RR Nagar
                </p>
              </button>
            </form>
          </div>

          {/* Right: Staff Portal Shortcut, Identity, Sign Out */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Quick jump to Staff Portal */}
            <Link
              href="/staff"
              className="hidden md:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-sm border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors"
              title="Go to Staff Portal"
            >
              <LayoutDashboard className="size-3.5 text-caramel" />
              <span>Staff Portal</span>
            </Link>

            {/* Admin identity badge */}
            <div className="hidden sm:flex items-center gap-1.5 rounded-sm border border-amber-300 bg-amber-50/60 px-2.5 py-1 text-xs dark:border-amber-800 dark:bg-amber-950/40">
              <ShieldAlert className="size-3.5 text-amber-800 dark:text-amber-400" />
              <span className="font-medium text-amber-950 dark:text-amber-200 max-w-[120px] truncate">
                {email || "Administrator"}
              </span>
            </div>

            {/* Sign Out Action */}
            <form action={staffSignOutAction}>
              <button
                type="submit"
                title="Sign out of Admin Portal"
                className="flex h-9 items-center gap-1.5 rounded-sm border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer"
              >
                <LogOut className="size-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
