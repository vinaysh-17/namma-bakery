"use client";

import * as React from "react";
import Link from "next/link";
import {
  LogOut,
  ShieldCheck,
  User,
  Store,
} from "lucide-react";
import type { StaffRole } from "@/lib/staff/types";
import { staffSignOutAction, portalSignOutToHomeAction } from "@/lib/staff/actions";
import { maskUserEmail } from "@/lib/utils/mask";

interface StaffHeaderProps {
  email?: string | null;
  role: StaffRole | null;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function StaffHeader({
  email,
  role,
}: StaffHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Left: Branding & Staff Title (Clicks sign out and return to public home) */}
          <div className="flex items-center gap-3">
            <form action={portalSignOutToHomeAction} className="inline-flex">
              <button
                type="submit"
                title="Return to Namma Bakery public website (signs out)"
                className="group flex items-center gap-3 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel rounded-sm"
              >
                <div className="flex size-9 items-center justify-center rounded-sm bg-caramel/15 text-caramel group-hover:bg-caramel/25 transition-colors">
                  <Store className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-lg font-bold tracking-tight text-foreground group-hover:text-caramel transition-colors">
                      Namma Bakery
                    </span>
                    <span className="rounded-sm bg-caramel/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-caramel">
                      Staff
                    </span>
                  </div>
                  <p className="hidden text-xs text-muted-foreground sm:block">
                    Operations & Kitchen Queue · RR Nagar
                  </p>
                </div>
              </button>
            </form>
          </div>

          {/* Right: Account / User Badge, Admin Portal Shortcut, Sign Out */}
          <div className="flex items-center gap-2 sm:gap-3">

            {/* Account / Email + Role */}
            <div className="hidden sm:inline-flex h-9 items-center gap-2 rounded-sm border border-border bg-background px-2.5 text-xs shrink-0">
              {role === "ADMIN" ? (
                <ShieldCheck className="size-3.5 text-caramel shrink-0" />
              ) : (
                <User className="size-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="font-medium text-foreground max-w-[140px] truncate min-w-0">
                {email ? maskUserEmail(email) : "Staff Member"}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase shrink-0 ${
                  role === "ADMIN"
                    ? "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950 dark:text-amber-200"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {role || "STAFF"}
              </span>
            </div>

            {/* Admin Portal shortcut for ADMIN users */}
            {role === "ADMIN" && (
              <Link
                href="/admin"
                className="hidden md:inline-flex h-9 items-center gap-1.5 px-3 rounded-sm border border-amber-300 bg-amber-50 text-amber-900 text-xs font-semibold hover:bg-amber-100 transition-colors dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 cursor-pointer shrink-0"
                title="Go to Admin Portal"
              >
                <ShieldCheck className="size-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
                <span>Admin Portal</span>
              </Link>
            )}

            {/* Sign Out Form Action */}
            <form action={staffSignOutAction} className="inline-flex shrink-0">
              <button
                type="submit"
                title="Sign out of staff portal"
                className="flex h-9 items-center gap-1.5 rounded-sm border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer shrink-0"
              >
                <LogOut className="size-3.5 shrink-0" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
