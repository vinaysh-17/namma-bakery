"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Store,
  Users,
} from "lucide-react";
import { AdminHeader } from "./admin-header";
import { AdminOverviewView } from "./admin-overview-view";
import { AdminCatalogView } from "./admin-catalog-view";
import { AdminStoreOperationsView } from "./admin-store-operations-view";
import { AdminStaffView } from "./admin-staff-view";
import { isStoreCurrentlyPaused } from "@/lib/utils/date";
import type {
  AdminOverviewSummary,
  AdminCategory,
  AdminProduct,
  AdminPriceTierWithRules,
  LocationInfo,
  StoreSettings,
  SpecialClosure,
  BusinessHour,
  AdminStaffMember,
  AuditLogEntry,
} from "@/lib/admin/types";

export type AdminTab =
  | "OVERVIEW"
  | "CATALOG"
  | "STORE_OPS"
  | "STAFF";

interface AdminDashboardProps {
  summary: AdminOverviewSummary;
  categories: AdminCategory[];
  products: AdminProduct[];
  priceTiers: AdminPriceTierWithRules[];
  location: LocationInfo | null;
  settings: StoreSettings | null;
  closures: SpecialClosure[];
  hours: BusinessHour[];
  staff: AdminStaffMember[];
  auditLogs: AuditLogEntry[];
  currentUserEmail?: string | null;
  currentUserId?: string | null;
}

function useIsStorePaused(pauseTimestamp: string | null | undefined): boolean {
  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!pauseTimestamp) return () => {};
      const targetMs = new Date(pauseTimestamp).getTime();
      if (Number.isNaN(targetMs)) return () => {};
      const remainingMs = targetMs - Date.now();
      if (remainingMs <= 0) return () => {};
      const timer = setTimeout(notify, remainingMs);
      return () => clearTimeout(timer);
    },
    [pauseTimestamp]
  );

  const getSnapshot = React.useCallback(() => {
    return isStoreCurrentlyPaused(pauseTimestamp);
  }, [pauseTimestamp]);

  const getServerSnapshot = React.useCallback(() => {
    return false;
  }, []);

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function AdminDashboard({
  summary,
  categories,
  products,
  priceTiers,
  location,
  settings,
  closures,
  hours,
  staff,
  auditLogs,
  currentUserEmail,
  currentUserId,
}: AdminDashboardProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<AdminTab>("OVERVIEW");

  // Derive live store pause state on the client from ordersPausedUntil via useSyncExternalStore
  // Server snapshot returns false (no prerender Date.now() access); client snapshot evaluates live time
  const pauseTimestamp = summary.ordersPausedUntil || settings?.orders_paused_until;
  const isStorePaused = useIsStorePaused(pauseTimestamp);

  const liveSummary = React.useMemo(
    () => ({
      ...summary,
      isStorePaused,
    }),
    [summary, isStorePaused]
  );

  const handleActionSuccess = () => {
    router.refresh();
  };

  const handleNavigateTab = (tab: string) => {
    if (tab === "PRODUCTS" || tab === "CATEGORIES" || tab === "CAKE_TIERS" || tab === "CATALOG") {
      setActiveTab("CATALOG");
    } else {
      setActiveTab(tab as AdminTab);
    }
  };

  const navItems: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: "OVERVIEW", label: "Overview", icon: LayoutDashboard },
    { id: "CATALOG", label: "Catalog", icon: Package },
    { id: "STORE_OPS", label: "Store Operations", icon: Store },
    { id: "STAFF", label: "Staff Team", icon: Users },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Header */}
      <AdminHeader email={currentUserEmail} />

      {/* Main Tab Navigation */}
      <div className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-16 z-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto py-2 no-scrollbar">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`h-9 px-3 rounded-sm text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-caramel text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                  }`}
                >
                  <Icon className="size-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Dashboard Body Content */}
      <div
        className={`flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 ${
          activeTab === "CATALOG" ? "pt-0 pb-6" : "py-6"
        }`}
      >
        {activeTab === "OVERVIEW" && (
          <AdminOverviewView
            summary={liveSummary}
            auditLogs={auditLogs}
            onNavigateTab={handleNavigateTab}
          />
        )}

        {activeTab === "CATALOG" && (
          <AdminCatalogView
            categories={categories}
            products={products}
            priceTiers={priceTiers}
            onActionSuccess={handleActionSuccess}
          />
        )}

        {activeTab === "STORE_OPS" && (
          <AdminStoreOperationsView
            location={location}
            settings={settings}
            closures={closures}
            hours={hours}
            isStorePaused={isStorePaused}
            onActionSuccess={handleActionSuccess}
          />
        )}

        {activeTab === "STAFF" && (
          <AdminStaffView
            staff={staff}
            currentUserEmail={currentUserEmail}
            currentUserId={currentUserId}
            onActionSuccess={handleActionSuccess}
          />
        )}
      </div>
    </div>
  );
}
