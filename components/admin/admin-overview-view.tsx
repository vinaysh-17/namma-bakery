"use client";

import * as React from "react";
import {
  Package,
  Store,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  History,
} from "lucide-react";
import type { AdminOverviewSummary, AuditLogEntry } from "@/lib/admin/types";
import { formatIstDateTime } from "@/lib/utils/date";

interface AdminOverviewViewProps {
  summary: AdminOverviewSummary;
  auditLogs: AuditLogEntry[];
  onNavigateTab: (tab: string) => void;
}

export function AdminOverviewView({
  summary,
  auditLogs,
  onNavigateTab,
}: AdminOverviewViewProps) {
  return (
    <div className="space-y-6">
      {/* Store Pause Alert Banner (if store is paused) */}
      {summary.isStorePaused && (
        <div className="rounded-sm border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="size-5 text-amber-600 shrink-0" />
              <div>
                <p className="font-semibold text-xs sm:text-sm">
                  Online Ordering is Currently Paused
                </p>
                <p className="text-xs text-amber-900/80 dark:text-amber-300/80 mt-0.5">
                  {summary.pauseMessage || "Store orders are temporarily halted."}
                  {summary.ordersPausedUntil && (
                    <span className="ml-1 font-mono text-[11px]">
                      (until {formatIstDateTime(summary.ordersPausedUntil)})
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("STORE_OPS")}
              className="h-8 px-3 rounded-sm bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 transition-colors shrink-0 cursor-pointer"
            >
              Manage Store Settings
            </button>
          </div>
        </div>
      )}

      {/* 1. Menu & Products Management Card */}
      <div className="rounded-sm border border-border bg-card p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-caramel" />
          <h3 className="font-heading font-bold text-sm text-foreground">
            Menu & Products
          </h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Manage baked goods, prices, availability, dietary tags, and cake pricing tiers.
        </p>
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border/40">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {summary.totalProducts} {summary.totalProducts === 1 ? "Product" : "Products"}
            </span>
            <span>·</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
              {summary.availableProducts} active
            </span>
            {summary.archivedProducts > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-700 dark:text-amber-400">
                  {summary.archivedProducts} archived
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab("CATALOG")}
            className="h-8 px-3 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors flex items-center justify-center gap-1.5 cursor-pointer w-full sm:w-auto shrink-0"
          >
            <span>Catalog Manager</span>
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Store & Closures and Staff Authorization Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Store & Closures */}
        <div className="rounded-sm border border-border bg-card p-4 sm:p-5 flex flex-col justify-between space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Store className="size-4 text-emerald-700 dark:text-emerald-400" />
              <h3 className="font-heading font-bold text-sm text-foreground">
                Store & Closures
              </h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Configure order capacities, time slots, emergency pause, and scheduled holiday closures.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onNavigateTab("STORE_OPS")}
              className="h-8 px-3 rounded-sm border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer w-full sm:w-auto"
            >
              Configure Store Operations
            </button>
          </div>
        </div>

        {/* Staff Authorization */}
        <div className="rounded-sm border border-border bg-card p-4 sm:p-5 flex flex-col justify-between space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-amber-700 dark:text-amber-400" />
              <h3 className="font-heading font-bold text-sm text-foreground">
                Staff Authorization
              </h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Review bakery personnel, manage employee roles, and control access to bakery portals.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onNavigateTab("STAFF")}
              className="h-8 px-3 rounded-sm border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer w-full sm:w-auto"
            >
              Manage Staff Team
            </button>
          </div>
        </div>
      </div>

      {/* 3. Recent Administrative Audit Trail */}
      <div className="rounded-sm border border-border bg-card p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="size-4 text-caramel" />
            <h3 className="font-heading font-bold text-sm sm:text-base text-foreground">
              Administrative Audit Log
            </h3>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Automated database trigger log (audit_logs)
          </span>
        </div>

        {auditLogs.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No audit log entries recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="py-2 px-3 font-semibold">Timestamp (IST)</th>
                  <th className="py-2 px-3 font-semibold">Actor Role</th>
                  <th className="py-2 px-3 font-semibold">Entity</th>
                  <th className="py-2 px-3 font-semibold">Action</th>
                  <th className="py-2 px-3 font-semibold">Entity ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditLogs.slice(0, 10).map((log) => (
                  <tr key={log.id} className="hover:bg-muted/20">
                    <td className="py-2 px-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                      {formatIstDateTime(log.created_at)}
                    </td>
                    <td className="py-2 px-3 font-semibold text-foreground">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-muted uppercase">
                        {log.actor_role}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-medium text-foreground">
                      {log.entity_type}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-muted-foreground">
                      {log.action}
                    </td>
                    <td className="py-2 px-3 font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">
                      {log.entity_id || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
