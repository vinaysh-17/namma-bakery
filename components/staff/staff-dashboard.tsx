"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { StaffHeader } from "./staff-header";
import { StaffOverview } from "./staff-overview";
import { StaffOrderList } from "./staff-order-list";
import { StaffOrderDetail } from "./staff-order-detail";
import { StaffStatusModal, type ModalType } from "./staff-status-modal";
import { StaffCustomCakeOverview } from "./staff-custom-cake-overview";
import {
  StaffCustomCakeList,
  type CustomCakeFilterTab,
} from "./staff-custom-cake-list";
import { StaffCustomCakeDetail } from "./staff-custom-cake-detail";
import {
  StaffCustomCakeModal,
  type CustomCakeModalType,
} from "./staff-custom-cake-modal";
import type {
  StaffOrder,
  StaffRole,
  OperationalSummary,
  OrderFilter,
} from "@/lib/staff/types";
import type {
  CustomCakeRequest,
  CustomCakeOperationalSummary,
} from "@/lib/custom-cake/types";
import { Coffee, ShoppingBag, Sparkles, CalendarDays } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationsProvider } from "@/components/notifications/notifications-context";
import { NotificationToastContainer } from "@/components/notifications/notification-toasts";
import type { PortalNotification } from "@/lib/notifications/types";
import { getIstDateString, formatIstDate } from "@/lib/utils/date";
import {
  calculateOperationalSummary,
  calculateCustomCakeSummary,
} from "@/lib/staff/summary";

interface StaffDashboardProps {
  orders: StaffOrder[];
  summary: OperationalSummary;
  customCakeRequests: CustomCakeRequest[];
  customCakeSummary: CustomCakeOperationalSummary;
  userEmail?: string | null;
  role: StaffRole | null;
  initialNotifications?: PortalNotification[];
  initialUnreadCount?: number;
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d} / ${m} / ${y}`;
}

export function StaffDashboard({
  orders,
  customCakeRequests,
  userEmail,
  role,
  initialNotifications = [],
  initialUnreadCount = 0,
}: StaffDashboardProps) {
  const router = useRouter();

  // Navigation tab: regular orders vs custom celebration cakes
  const [activeTab, setActiveTab] = React.useState<"ORDERS" | "CUSTOM_CAKES">(
    "ORDERS"
  );

  // Common today date in IST
  const todayIst = React.useMemo(() => getIstDateString(), []);

  // Orders queue state
  const [selectedDate, setSelectedDate] = React.useState<string>(todayIst);
  const [activeOrderFilter, setActiveOrderFilter] =
    React.useState<OrderFilter>("ALL");
  const [selectedOrderId, setSelectedOrderId] = React.useState<string | null>(
    orders[0]?.id || null
  );
  const [activeOrderModal, setActiveOrderModal] =
    React.useState<ModalType | null>(null);

  // Filter orders for the selected date (created_at in IST)
  const ordersForSelectedDate = React.useMemo(() => {
    return orders.filter(
      (o) => getIstDateString(o.created_at) === selectedDate
    );
  }, [orders, selectedDate]);

  // Operational summary for the selected date
  const summaryForSelectedDate = React.useMemo(() => {
    return calculateOperationalSummary(orders, selectedDate);
  }, [orders, selectedDate]);

  // Custom cake queue state
  const [selectedCustomCakeDate, setSelectedCustomCakeDate] =
    React.useState<string>(todayIst);
  const [activeCustomCakeFilter, setActiveCustomCakeFilter] =
    React.useState<CustomCakeFilterTab>("ALL");
  const [selectedCustomCakeId, setSelectedCustomCakeId] = React.useState<
    string | null
  >(customCakeRequests[0]?.id || null);
  const [activeCustomCakeModal, setActiveCustomCakeModal] =
    React.useState<CustomCakeModalType | null>(null);

  // Filter custom cake requests for the selected date (created_at in IST)
  const customCakeRequestsForSelectedDate = React.useMemo(() => {
    return customCakeRequests.filter(
      (r) => getIstDateString(r.created_at) === selectedCustomCakeDate
    );
  }, [customCakeRequests, selectedCustomCakeDate]);

  // Operational summary for custom cake requests for the selected date
  const customCakeSummaryForSelectedDate = React.useMemo(() => {
    return calculateCustomCakeSummary(customCakeRequests, selectedCustomCakeDate);
  }, [customCakeRequests, selectedCustomCakeDate]);

  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // Sync state with URL search parameters (deep-linking from notifications / toasts)
  React.useEffect(() => {
    function syncFromUrl() {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      const orderIdParam = params.get("orderId");
      const requestIdParam = params.get("requestId");

      if (tabParam === "CUSTOM_CAKES" || requestIdParam) {
        setActiveTab("CUSTOM_CAKES");
        if (requestIdParam) {
          const match = customCakeRequests.find((r) => r.id === requestIdParam);
          if (match) {
            setSelectedCustomCakeDate(getIstDateString(match.created_at));
            setSelectedCustomCakeId(match.id);
            setActiveCustomCakeFilter("ALL");
          } else {
            setSelectedCustomCakeId(requestIdParam);
            setActiveCustomCakeFilter("ALL");
          }
        }
      } else if (tabParam === "ORDERS" || orderIdParam) {
        setActiveTab("ORDERS");
        if (orderIdParam) {
          const match = orders.find((o) => o.id === orderIdParam);
          if (match) {
            setSelectedDate(getIstDateString(match.created_at));
            setSelectedOrderId(match.id);
            setActiveOrderFilter("ALL");
          } else {
            setSelectedOrderId(orderIdParam);
            setActiveOrderFilter("ALL");
          }
        }
      }
    }

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [orders, customCakeRequests]);

  // User-scoped unread custom cake tracking
  const storageKey = React.useMemo(() => {
    return `namma_bakery_staff_custom_cake_last_seen_${userEmail || "default"}`;
  }, [userEmail]);

  // Read initial seen timestamp lazily from localStorage or default to latest request timestamp
  const [lastSeenTimestamp, setLastSeenTimestamp] = React.useState<number>(() => {
    const latestReq = customCakeRequests[0];
    if (typeof window === "undefined") {
      return latestReq ? new Date(latestReq.created_at).getTime() : 0;
    }
    const initialTime = latestReq ? new Date(latestReq.created_at).getTime() : Date.now();
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) return parsed;
      }
      localStorage.setItem(storageKey, String(initialTime));
      return initialTime;
    } catch {
      return initialTime;
    }
  });

  // Switch tabs and mark as seen when opening Custom Cake Requests
  const handleSelectTab = (tab: "ORDERS" | "CUSTOM_CAKES") => {
    setActiveTab(tab);
    if (tab === "CUSTOM_CAKES") {
      const now = Date.now();
      try {
        localStorage.setItem(storageKey, String(now));
      } catch {
        // Safe guard
      }
      setLastSeenTimestamp(now);
    }
  };

  // Determine if there is any custom cake request created after the last seen timestamp
  const hasUnreadCustomCakes = React.useMemo(() => {
    if (activeTab === "CUSTOM_CAKES") return false;
    if (customCakeRequests.length === 0) return false;

    const latest = customCakeRequests[0];
    if (!latest?.created_at) return false;

    const latestTime = new Date(latest.created_at).getTime();
    return latestTime > lastSeenTimestamp;
  }, [activeTab, lastSeenTimestamp, customCakeRequests]);

  // Sync selected order objects scoped to the active date
  const selectedOrder = React.useMemo(() => {
    if (!ordersForSelectedDate.length) return null;
    return (
      ordersForSelectedDate.find((o) => o.id === selectedOrderId) ||
      ordersForSelectedDate[0] ||
      null
    );
  }, [ordersForSelectedDate, selectedOrderId]);

  // Sync selected custom cake enquiry scoped to the active date
  const selectedCustomCake = React.useMemo(() => {
    if (!customCakeRequestsForSelectedDate.length) return null;
    return (
      customCakeRequestsForSelectedDate.find((c) => c.id === selectedCustomCakeId) ||
      customCakeRequestsForSelectedDate[0] ||
      null
    );
  }, [customCakeRequestsForSelectedDate, selectedCustomCakeId]);

  // Active/queued counts for tab badges (exclude terminal/resolved states)
  const queuedOrdersCount = React.useMemo(() => {
    return (orders || []).filter(
      (o) =>
        !["COMPLETED", "CANCELLED", "REJECTED", "NO_SHOW"].includes(o.status)
    ).length;
  }, [orders]);

  const queuedCustomCakesCount = React.useMemo(() => {
    return (customCakeRequests || []).filter(
      (r) =>
        !["DECLINED", "CUSTOMER_DECLINED", "EXPIRED", "WITHDRAWN"].includes(
          r.status
        )
    ).length;
  }, [customCakeRequests]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleActionSuccess = () => {
    router.refresh();
  };

  return (
    <NotificationsProvider
      initialNotifications={initialNotifications}
      initialUnreadCount={initialUnreadCount}
    >
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <StaffHeader
          email={userEmail}
          role={role}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />

        {/* Section Switcher Tabs: Orders vs Custom Cakes + Notification Bell (Sticky below StaffHeader) */}
        <div className="sticky top-16 z-20 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-2.5 sm:py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0">
                <button
                  type="button"
                  onClick={() => handleSelectTab("ORDERS")}
                  className={`flex h-9 items-center gap-2 px-4 rounded-sm text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-colors shrink-0 cursor-pointer ${
                    activeTab === "ORDERS"
                      ? "bg-cocoa text-cream"
                      : "border border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ShoppingBag className="size-4 shrink-0" />
                  <span>Orders Queue</span>
                  {queuedOrdersCount > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        activeTab === "ORDERS"
                          ? "bg-cream text-cocoa"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {queuedOrdersCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectTab("CUSTOM_CAKES")}
                  className={`flex h-9 items-center gap-2 px-4 rounded-sm text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-colors shrink-0 relative cursor-pointer ${
                    activeTab === "CUSTOM_CAKES"
                      ? "bg-caramel text-white"
                      : "border border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sparkles className="size-4 shrink-0" />
                  <span>Custom Cake Requests</span>
                  {queuedCustomCakesCount > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        activeTab === "CUSTOM_CAKES"
                          ? "bg-white text-caramel"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {queuedCustomCakesCount}
                    </span>
                  )}

                  {/* Notification pip if there are new unread enquiries */}
                  {hasUnreadCustomCakes && (
                    <span
                      className="size-2 rounded-full bg-amber-500 absolute -top-1 -right-1 ring-2 ring-background"
                      title="New custom cake request received"
                      aria-label="New unread custom cake request"
                    />
                  )}
                </button>
              </div>

              {/* Notification Bell anchored to the far right */}
              <div className="shrink-0 flex items-center">
                <NotificationBell />
              </div>
            </div>
          </div>
        </div>

        {/* Main Dashboard Container */}
        <div className="flex-1 mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8 space-y-6">

          {/* VIEW 1: REGULAR ORDERS QUEUE */}
          {activeTab === "ORDERS" && (
            <div className="space-y-6">
              {/* Date-Based Order History Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-sm border border-border bg-card">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-foreground">Order Date:</span>
                  <div className="relative inline-flex items-center">
                    <div className="flex h-8 items-center gap-2 px-3 rounded-sm border border-border bg-background text-xs font-semibold text-foreground hover:border-caramel/50 transition-colors cursor-pointer shadow-2xs">
                      <span>{formatDisplayDate(selectedDate)}</span>
                      <CalendarDays className="size-3.5 text-caramel shrink-0" />
                    </div>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => {
                        if (e.target.value) setSelectedDate(e.target.value);
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      aria-label="Select order date"
                      title="Click to select order date"
                    />
                  </div>
                  {selectedDate !== todayIst && (
                    <button
                      type="button"
                      onClick={() => setSelectedDate(todayIst)}
                      className="h-8 px-2.5 rounded-sm border border-caramel/40 bg-caramel/10 text-caramel hover:bg-caramel/20 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Jump to Today
                    </button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Showing orders created on <strong className="text-foreground">{formatIstDate(selectedDate)}</strong>
                  {selectedDate === todayIst && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950 dark:text-amber-200">
                      Today
                    </span>
                  )}
                </div>
              </div>

              <section aria-label="Operational Overview">
                <StaffOverview
                  summary={summaryForSelectedDate}
                  activeFilter={activeOrderFilter}
                  onSelectFilter={setActiveOrderFilter}
                  selectedDate={selectedDate}
                  todayIst={todayIst}
                />
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <section
                  aria-label="Order Queue"
                  className={`min-w-0 ${
                    selectedOrder
                      ? "hidden lg:block lg:col-span-7 xl:col-span-8"
                      : "col-span-12"
                  }`}
                >
                  <StaffOrderList
                    orders={ordersForSelectedDate}
                    selectedOrderId={selectedOrder?.id || null}
                    activeFilter={activeOrderFilter}
                    onSelectOrder={(order) => setSelectedOrderId(order.id)}
                    onSelectFilter={setActiveOrderFilter}
                  />
                </section>

                {selectedOrder ? (
                  <aside
                    aria-label="Order Details"
                    className="col-span-12 lg:col-span-5 xl:col-span-4 rounded-sm border border-border bg-card shadow-xs min-w-0"
                  >
                    <StaffOrderDetail
                      key={selectedOrder.id}
                      order={selectedOrder}
                      role={role}
                      onClose={() => setSelectedOrderId(null)}
                      onOpenModal={(modal) => setActiveOrderModal(modal)}
                    />
                  </aside>
                ) : (
                  <div className="hidden lg:flex col-span-5 xl:col-span-4 rounded-sm border border-dashed border-border p-12 flex-col items-center justify-center text-center text-muted-foreground space-y-3 min-h-[300px]">
                    <Coffee className="size-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">
                      Select an order to view full details
                    </p>
                    <p className="text-xs">
                      Inspect customer notes, cake message, items, and trigger
                      status updates.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW 2: CUSTOM CAKE ENQUIRIES */}
          {activeTab === "CUSTOM_CAKES" && (
            <div className="space-y-6">
              {/* Date-Based Custom Cake History Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-sm border border-border bg-card">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-foreground">Request Date:</span>
                  <div className="relative inline-flex items-center">
                    <div className="flex h-8 items-center gap-2 px-3 rounded-sm border border-border bg-background text-xs font-semibold text-foreground hover:border-caramel/50 transition-colors cursor-pointer shadow-2xs">
                      <span>{formatDisplayDate(selectedCustomCakeDate)}</span>
                      <CalendarDays className="size-3.5 text-caramel shrink-0" />
                    </div>
                    <input
                      type="date"
                      value={selectedCustomCakeDate}
                      onChange={(e) => {
                        if (e.target.value) setSelectedCustomCakeDate(e.target.value);
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      aria-label="Select request date"
                      title="Click to select request date"
                    />
                  </div>
                  {selectedCustomCakeDate !== todayIst && (
                    <button
                      type="button"
                      onClick={() => setSelectedCustomCakeDate(todayIst)}
                      className="h-8 px-2.5 rounded-sm border border-caramel/40 bg-caramel/10 text-caramel hover:bg-caramel/20 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Jump to Today
                    </button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Showing requests created on <strong className="text-foreground">{formatIstDate(selectedCustomCakeDate)}</strong>
                  {selectedCustomCakeDate === todayIst && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950 dark:text-amber-200">
                      Today
                    </span>
                  )}
                </div>
              </div>

              <section aria-label="Custom Cake Overview">
                <StaffCustomCakeOverview
                  summary={customCakeSummaryForSelectedDate}
                  activeFilter={activeCustomCakeFilter}
                  onSelectFilter={setActiveCustomCakeFilter}
                  selectedDate={selectedCustomCakeDate}
                  todayIst={todayIst}
                />
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <section
                  aria-label="Custom Cake Queue"
                  className={`min-w-0 ${
                    selectedCustomCake
                      ? "hidden lg:block lg:col-span-7 xl:col-span-8"
                      : "col-span-12"
                  }`}
                >
                  <StaffCustomCakeList
                    requests={customCakeRequestsForSelectedDate}
                    selectedRequestId={selectedCustomCakeId}
                    activeFilter={activeCustomCakeFilter}
                    onSelectRequest={(req) => setSelectedCustomCakeId(req.id)}
                    onSelectFilter={setActiveCustomCakeFilter}
                  />
                </section>

                {selectedCustomCake ? (
                  <aside
                    aria-label="Custom Cake Details"
                    className="col-span-12 lg:col-span-5 xl:col-span-4 rounded-sm border border-border bg-card shadow-xs min-w-0"
                  >
                    <StaffCustomCakeDetail
                      key={selectedCustomCake.id}
                      request={selectedCustomCake}
                      onClose={() => setSelectedCustomCakeId(null)}
                      onOpenModal={(modal) => setActiveCustomCakeModal(modal)}
                    />
                  </aside>
                ) : (
                  <div className="hidden lg:flex col-span-5 xl:col-span-4 rounded-sm border border-dashed border-border p-12 flex-col items-center justify-center text-center text-muted-foreground space-y-3 min-h-[300px]">
                    <Sparkles className="size-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">
                      Select a custom cake enquiry to inspect
                    </p>
                    <p className="text-xs">
                      Review design descriptions, reference photos, customer
                      details, and manage status.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Orders Transition Modal */}
        <StaffStatusModal
          modal={activeOrderModal}
          onClose={() => setActiveOrderModal(null)}
          onSuccess={handleActionSuccess}
        />

        {/* Custom Cake Status Modal */}
        <StaffCustomCakeModal
          modal={activeCustomCakeModal}
          onClose={() => setActiveCustomCakeModal(null)}
          onSuccess={handleActionSuccess}
        />

        {/* Live Toasts */}
        <NotificationToastContainer />
      </div>
    </NotificationsProvider>
  );
}
