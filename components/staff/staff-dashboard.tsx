"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StaffHeader } from "./staff-header";
import { StaffOverview } from "./staff-overview";
import { StaffDateNavigator } from "./staff-date-navigator";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { StaffOrderList } from "./staff-order-list";
import { StaffOrderDetail } from "./staff-order-detail";
import { StaffStatusModal, type ModalType } from "./staff-status-modal";
import { StaffCustomCakeList } from "./staff-custom-cake-list";
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
import { ShoppingBag, Sparkles } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationsProvider } from "@/components/notifications/notifications-context";
import { NotificationToastContainer } from "@/components/notifications/notification-toasts";
import type { PortalNotification } from "@/lib/notifications/types";
import { getIstDateString, formatIstDate } from "@/lib/utils/date";
import { calculateOperationalSummary } from "@/lib/staff/summary";
import {
  calculateCustomCakeOrderSummary,
  getCustomCakeStaffStatus,
  matchesStaffFilter,
} from "@/lib/staff/custom-cake-workflow";

interface StaffDashboardProps {
  orders: StaffOrder[];
  summary: OperationalSummary;
  customCakeRequests: CustomCakeRequest[];
  customCakeSummary: CustomCakeOperationalSummary;
  userEmail?: string | null;
  role: StaffRole | null;
  initialNotifications?: PortalNotification[];
  initialUnreadCount?: number;
  /** Realtime ping topic: other staff / customer activity triggers a soft data refresh */
  liveTopic?: string;
}

export function StaffDashboard({
  orders,
  customCakeRequests,
  userEmail,
  role,
  initialNotifications = [],
  initialUnreadCount = 0,
  liveTopic,
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
  // Selection is only ever set by an explicit user action (row click / deep link).
  const [selectedOrderId, setSelectedOrderId] = React.useState<string | null>(
    null
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
    React.useState<OrderFilter>("ALL");
  const [selectedCustomCakeId, setSelectedCustomCakeId] = React.useState<
    string | null
  >(null);
  // Set when staff click "Photo Attached": which request, and a nonce that changes per click
  const [photoFocus, setPhotoFocus] = React.useState<{
    id: string;
    nonce: number;
  } | null>(null);
  // Pending-stage dialogs (accept / reject a request)
  const [activeCustomCakeModal, setActiveCustomCakeModal] =
    React.useState<CustomCakeModalType | null>(null);
  // Order-stage dialogs (ready / collect payment & handover / cancel) for the linked order
  const [activeCustomOrderModal, setActiveCustomOrderModal] =
    React.useState<ModalType | null>(null);

  // Orders created from custom cake requests, keyed by request id
  const linkedOrderByRequestId = React.useMemo(() => {
    const map = new Map<string, StaffOrder>();
    for (const o of orders) {
      if (o.custom_request_id) map.set(o.custom_request_id, o);
    }
    return map;
  }, [orders]);

  // Order-style staff status of a request (from its linked order, else its enquiry stage)
  const getStaffStatus = React.useCallback(
    (req: CustomCakeRequest) =>
      getCustomCakeStaffStatus(req, linkedOrderByRequestId.get(req.id)),
    [linkedOrderByRequestId]
  );

  // Requests in the active view:
  // "PENDING" => every PENDING request across all dates (global pending workload)
  // otherwise => requests created on the given date
  const getCustomCakeView = React.useCallback(
    (filter: OrderFilter, date: string) => {
      if (filter === "PENDING") {
        return customCakeRequests.filter(
          (r) => getStaffStatus(r) === "PENDING"
        );
      }
      return customCakeRequests.filter(
        (r) => getIstDateString(r.created_at) === date
      );
    },
    [customCakeRequests, getStaffStatus]
  );

  const customCakeRequestsForView = React.useMemo(
    () => getCustomCakeView(activeCustomCakeFilter, selectedCustomCakeDate),
    [getCustomCakeView, activeCustomCakeFilter, selectedCustomCakeDate]
  );

  // Summary: date-specific, except Pending which is the global pending workload
  const customCakeSummaryForSelectedDate = React.useMemo(() => {
    return calculateCustomCakeOrderSummary(
      customCakeRequests.map((r) => ({
        created_at: r.created_at,
        staffStatus: getStaffStatus(r),
      })),
      selectedCustomCakeDate,
      (iso) => getIstDateString(iso)
    );
  }, [customCakeRequests, getStaffStatus, selectedCustomCakeDate]);

  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [appliedDeepLinkKey, setAppliedDeepLinkKey] = React.useState<string | null>(null);
  const refreshRequestedForKey = React.useRef<string | null>(null);
  const searchParams = useSearchParams();
  const urlKey = searchParams.toString();

  // Remove only the record-selection params from the URL (keeps tab and anything else),
  // without a navigation or server round trip.
  const clearUrlSelection = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("orderId") && !params.has("requestId")) return;
    params.delete("orderId");
    params.delete("requestId");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    );
  }, []);

  // URL -> state: deep links from notifications / toasts, including when the portal is
  // already open (router.push updates useSearchParams). Selection IDs come from the
  // structured notification link, never from message text. State is adjusted during
  // render (keyed on the URL) rather than in an effect.
  const urlParams = new URLSearchParams(urlKey);
  const tabParam = urlParams.get("tab");
  const orderIdParam = urlParams.get("orderId");
  const requestIdParam = urlParams.get("requestId");
  const deepLinkKey = `${tabParam || ""}:${orderIdParam || ""}:${requestIdParam || ""}`;

  const deepLinkRequest = requestIdParam
    ? customCakeRequests.find((r) => r.id === requestIdParam)
    : undefined;
  const deepLinkOrder =
    !requestIdParam && orderIdParam
      ? orders.find((o) => o.id === orderIdParam)
      : undefined;
  // A linked record that is not in the loaded data yet (e.g. just created)
  const deepLinkMissing =
    (Boolean(requestIdParam) && !deepLinkRequest) ||
    (!requestIdParam && Boolean(orderIdParam) && !deepLinkOrder);

  if (deepLinkKey !== appliedDeepLinkKey && !deepLinkMissing) {
    setAppliedDeepLinkKey(deepLinkKey);
    if (deepLinkRequest) {
      setActiveTab("CUSTOM_CAKES");
      setActiveCustomCakeFilter("ALL");
      setSelectedCustomCakeDate(getIstDateString(deepLinkRequest.created_at));
      setSelectedCustomCakeId(deepLinkRequest.id);
      } else if (deepLinkOrder) {
      setActiveTab("ORDERS");
      setActiveOrderFilter("ALL");
      setSelectedDate(getIstDateString(deepLinkOrder.created_at));
      setSelectedOrderId(deepLinkOrder.id);
    } else if (
      appliedDeepLinkKey === null &&
      (tabParam === "CUSTOM_CAKES" || tabParam === "ORDERS")
    ) {
      // Tab-only URL: honour on first load only, so clearing a selection param later
      // never switches tabs under the user
      setActiveTab(tabParam);
    }
  }

  // Missing linked record: refresh server data once; the render-time sync above then
  // applies the link automatically when the new props arrive.
  React.useEffect(() => {
    if (deepLinkMissing && refreshRequestedForKey.current !== deepLinkKey) {
      refreshRequestedForKey.current = deepLinkKey;
      router.refresh();
    }
  }, [deepLinkMissing, deepLinkKey, router]);

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

  // Selected order: resolved only from the explicit selected ID (kept across status
  // changes so the panel stays on the same order after an action). Never auto-selects.
  const selectedOrder = React.useMemo(() => {
    if (!selectedOrderId) return null;
    return orders.find((o) => o.id === selectedOrderId) || null;
  }, [orders, selectedOrderId]);

  // Selected custom cake request must belong to the active view AND the active status
  // filter. Never falls back to another request; if a status change moves it out of the
  // active filter, the selection resolves to null and the panel closes.
  const selectedCustomCake = React.useMemo(() => {
    if (!selectedCustomCakeId) return null;
    return (
      customCakeRequestsForView.find(
        (c) =>
          c.id === selectedCustomCakeId &&
          matchesStaffFilter(getStaffStatus(c), activeCustomCakeFilter)
      ) || null
    );
  }, [
    customCakeRequestsForView,
    selectedCustomCakeId,
    activeCustomCakeFilter,
    getStaffStatus,
  ]);

  // Drop a selection that is no longer valid (e.g. a status change moved it out of the
  // active filter) so it can never silently reappear under another filter.
  if (selectedCustomCakeId && !selectedCustomCake) {
    setSelectedCustomCakeId(null);
  }

  // ---- Orders handlers ----
  const handleSelectOrder = (order: StaffOrder) => {
    setSelectedOrderId(order.id);
    clearUrlSelection();
  };

  const handleCloseOrder = () => {
    setSelectedOrderId(null);
    clearUrlSelection();
  };

  const handleOrderDateChange = (date: string) => {
    setSelectedDate(date);
    // Drop the selection if it does not belong to the newly selected date
    const current = selectedOrderId
      ? orders.find((o) => o.id === selectedOrderId)
      : null;
    if (!current || getIstDateString(current.created_at) !== date) {
      setSelectedOrderId(null);
      clearUrlSelection();
    }
  };

  // ---- Custom cake handlers ----
  const handleCloseCustomCake = () => {
    setSelectedCustomCakeId(null);
    setPhotoFocus(null);
    clearUrlSelection();
  };

  const handleSelectCustomCake = (req: CustomCakeRequest | null) => {
    setSelectedCustomCakeId(req ? req.id : null);
    setPhotoFocus(null);
    clearUrlSelection();
  };

  // "Photo Attached" badge: same selection as clicking the card, plus a photo-focus signal
  const handleViewCustomCakePhoto = (req: CustomCakeRequest) => {
    setSelectedCustomCakeId(req.id);
    // Date.now() is unique per click, so a repeat click on the same request still fires
    setPhotoFocus({ id: req.id, nonce: Date.now() });
    clearUrlSelection();
  };

  const handleCustomCakeDateChange = (date: string) => {
    setSelectedCustomCakeDate(date);
    const stillValid =
      selectedCustomCakeId !== null &&
      getCustomCakeView(activeCustomCakeFilter, date).some(
        (r) => r.id === selectedCustomCakeId
      );
    if (!stillValid) {
      setSelectedCustomCakeId(null);
      clearUrlSelection();
    }
  };

  // Summary-card filter change: keep the selection only if it is still in the new view
  const handleSelectCustomCakeFilter = (filter: OrderFilter) => {
    setActiveCustomCakeFilter(filter);
    const stillValid =
      selectedCustomCakeId !== null &&
      getCustomCakeView(filter, selectedCustomCakeDate).some(
        (r) =>
          r.id === selectedCustomCakeId &&
          matchesStaffFilter(getStaffStatus(r), filter)
      );
    if (!stillValid) {
      setSelectedCustomCakeId(null);
      clearUrlSelection();
    }
  };

  // Pending review orders count for top navigation badge (strictly PENDING orders waiting for action)
  const pendingOrdersCount = React.useMemo(() => {
    return (orders || []).filter((o) => o.status === "PENDING").length;
  }, [orders]);

  // Pending custom cake count for the top navigation badge (global, any date)
  const pendingCustomCakesCount = React.useMemo(() => {
    return customCakeRequests.filter((r) => getStaffStatus(r) === "PENDING")
      .length;
  }, [customCakeRequests, getStaffStatus]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  // Order action: stay on the same order (never move to another one)
  const handleActionSuccess = (orderId?: string) => {
    if (orderId) {
      setSelectedOrderId(orderId);
    }
    router.refresh();
  };

  // Custom cake / linked-order action: the same request stays selected and the panel
  // updates in place once fresh data arrives. If the new status no longer belongs to the
  // active filter, the selection resolves to null and the panel closes.
  const handleCustomCakeActionSuccess = (requestId: string) => {
    setSelectedCustomCakeId(requestId);
    router.refresh();
  };

  return (
    <NotificationsProvider
      initialNotifications={initialNotifications}
      initialUnreadCount={initialUnreadCount}
    >
      <div className="min-h-screen bg-background flex flex-col">
        {liveTopic && <LiveRefresh topic={liveTopic} />}
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
                  {pendingOrdersCount > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        activeTab === "ORDERS"
                          ? "bg-cream text-cocoa"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {pendingOrdersCount}
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
                  {pendingCustomCakesCount > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        activeTab === "CUSTOM_CAKES"
                          ? "bg-white text-caramel"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {pendingCustomCakesCount}
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
              <StaffDateNavigator
                label="Order Date:"
                noun="order"
                value={selectedDate}
                todayIst={todayIst}
                onChange={handleOrderDateChange}
              >
                Showing orders created on <strong className="text-foreground">{formatIstDate(selectedDate)}</strong>
                {selectedDate === todayIst && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950 dark:text-amber-200">
                    Today
                  </span>
                )}
              </StaffDateNavigator>

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
                    onSelectOrder={handleSelectOrder}
                    onSelectFilter={setActiveOrderFilter}
                  />
                </section>

                {selectedOrder && (
                  <aside
                    aria-label="Order Details"
                    className="col-span-12 lg:col-span-5 xl:col-span-4 rounded-sm border border-border bg-card shadow-xs min-w-0"
                  >
                    <StaffOrderDetail
                      key={selectedOrder.id}
                      order={selectedOrder}
                      role={role}
                      onClose={handleCloseOrder}
                      onOpenModal={(modal) => setActiveOrderModal(modal)}
                    />
                  </aside>
                )}
              </div>
            </div>
          )}

          {/* VIEW 2: CUSTOM CAKE ENQUIRIES */}
          {activeTab === "CUSTOM_CAKES" && (
            <div className="space-y-6">
              {/* Date-Based Custom Cake History Toolbar */}
              <StaffDateNavigator
                label="Request Date:"
                noun="request"
                value={selectedCustomCakeDate}
                todayIst={todayIst}
                onChange={handleCustomCakeDateChange}
              >
                {activeCustomCakeFilter === "PENDING" ? (
                  <span>
                    Showing <strong className="text-amber-700 dark:text-amber-400">all pending review enquiries across all dates</strong>
                  </span>
                ) : (
                  <>
                    Showing requests created on <strong className="text-foreground">{formatIstDate(selectedCustomCakeDate)}</strong>
                    {selectedCustomCakeDate === todayIst && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950 dark:text-amber-200">
                        Today
                      </span>
                    )}
                  </>
                )}
              </StaffDateNavigator>

              <section aria-label="Custom Cake Overview">
                <StaffOverview
                  summary={customCakeSummaryForSelectedDate}
                  activeFilter={activeCustomCakeFilter}
                  onSelectFilter={handleSelectCustomCakeFilter}
                  selectedDate={selectedCustomCakeDate}
                  todayIst={todayIst}
                  totalLabel={
                    selectedCustomCakeDate === todayIst
                      ? "Today's Requests"
                      : "Selected Date Requests"
                  }
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
                    requests={customCakeRequestsForView}
                    getStaffStatus={getStaffStatus}
                    selectedRequestId={selectedCustomCake?.id ?? null}
                    activeFilter={activeCustomCakeFilter}
                    onSelectRequest={handleSelectCustomCake}
                    onSelectFilter={handleSelectCustomCakeFilter}
                    onViewPhoto={handleViewCustomCakePhoto}
                  />
                </section>

                {selectedCustomCake && (
                  <aside
                    aria-label="Custom Cake Details"
                    className="col-span-12 lg:col-span-5 xl:col-span-4 rounded-sm border border-border bg-card shadow-xs min-w-0"
                  >
                    <StaffCustomCakeDetail
                      key={selectedCustomCake.id}
                      request={selectedCustomCake}
                      staffStatus={getStaffStatus(selectedCustomCake)}
                      linkedOrder={linkedOrderByRequestId.get(selectedCustomCake.id)}
                      onClose={handleCloseCustomCake}
                      onOpenModal={(modal) => setActiveCustomCakeModal(modal)}
                      onOpenOrderModal={(modal) => setActiveCustomOrderModal(modal)}
                      photoFocusNonce={
                        photoFocus?.id === selectedCustomCake.id ? photoFocus.nonce : 0
                      }
                    />
                  </aside>
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
          onStale={() => router.refresh()}
        />

        {/* Custom cake: accept / reject a pending request */}
        <StaffCustomCakeModal
          modal={activeCustomCakeModal}
          onClose={() => setActiveCustomCakeModal(null)}
          onSuccess={handleCustomCakeActionSuccess}
        />

        {/* Custom cake: order-stage actions on the linked order (same dialogs as Orders Queue) */}
        <StaffStatusModal
          modal={activeCustomOrderModal}
          onClose={() => setActiveCustomOrderModal(null)}
          onSuccess={() => {
            if (selectedCustomCakeId) handleCustomCakeActionSuccess(selectedCustomCakeId);
            else router.refresh();
          }}
        />

        {/* Live Toasts */}
        <NotificationToastContainer />
      </div>
    </NotificationsProvider>
  );
}
