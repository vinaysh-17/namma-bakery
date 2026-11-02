"use client";

import * as React from "react";
import {
  Search,
  Clock,
  Sparkles,
  Phone,
  AlertCircle,
  ChevronRight,
  Filter,
  X,
} from "lucide-react";
import type { StaffOrder, OrderFilter } from "@/lib/staff/types";
import { formatPaise } from "@/lib/utils/money";
import { formatIstDate, formatIstTime, getIstDateString } from "@/lib/utils/date";
import { formatOrderItemVariant, formatOrderStatusLabel } from "@/lib/staff/formatters";

interface StaffOrderListProps {
  orders: StaffOrder[];
  selectedOrderId: string | null;
  activeFilter: OrderFilter;
  onSelectOrder: (order: StaffOrder) => void;
  onSelectFilter: (filter: OrderFilter) => void;
}

export function StaffOrderList({
  orders,
  selectedOrderId,
  activeFilter,
  onSelectOrder,
  onSelectFilter,
}: StaffOrderListProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const todayIst = getIstDateString();

  // Filter orders based on active filter tab and search query
  const filteredOrders = React.useMemo(() => {
    return orders.filter((order) => {
      // 1. Status Filter (Controlled via Overview Summary Cards)
      if (activeFilter === "TODAY" || activeFilter === "ALL") {
        // Show all orders for the current set
      } else if (activeFilter === "PENDING" && order.status !== "PENDING") {
        return false;
      } else if (
        activeFilter === "ACCEPTED" &&
        order.status !== "ACCEPTED" &&
        order.status !== "PREPARING"
      ) {
        return false;
      } else if (
        activeFilter === "READY_FOR_PICKUP" &&
        order.status !== "READY_FOR_PICKUP"
      ) {
        return false;
      } else if (activeFilter === "COMPLETED" && order.status !== "COMPLETED") {
        return false;
      } else if (
        activeFilter === "CANCELLED_OR_REJECTED" &&
        !["CANCELLED", "REJECTED", "NO_SHOW"].includes(order.status)
      ) {
        return false;
      }

      // 2. Search Query (order_number, customer_name, customer_phone)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesOrder = order.order_number.toLowerCase().includes(q);
        const matchesName = order.customer_name.toLowerCase().includes(q);
        const matchesPhone = order.customer_phone.includes(q);
        return matchesOrder || matchesName || matchesPhone;
      }

      return true;
    });
  }, [orders, activeFilter, searchQuery]);

  const getStatusBadge = (status: StaffOrder["status"]) => {
    switch (status) {
      case "PENDING":
        return "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-300";
      case "ACCEPTED":
        return "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950 dark:text-blue-300";
      case "PREPARING":
        return "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950 dark:text-orange-300";
      case "READY_FOR_PICKUP":
        return "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300";
      case "COMPLETED":
        return "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900 dark:text-slate-300";
      case "REJECTED":
      case "CANCELLED":
      case "NO_SHOW":
        return "bg-destructive/15 text-destructive border-destructive/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getFilterDisplayName = (filter: OrderFilter) => {
    switch (filter) {
      case "PENDING":
        return "pending";
      case "ACCEPTED":
        return "accepted / in-prep";
      case "READY_FOR_PICKUP":
        return "ready for pickup";
      case "COMPLETED":
        return "completed";
      case "CANCELLED_OR_REJECTED":
        return "cancelled / rejected";
      default:
        return "";
    }
  };

  const isFiltered = activeFilter !== "ALL" && activeFilter !== "TODAY";

  return (
    <div className="space-y-4">
      {/* Search Header & Filter Status Indicator */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search order #, customer name, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[42px] rounded-sm border border-border bg-card pl-10 pr-12 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-0 top-0 bottom-0 w-12 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              aria-label="Clear order search"
              title="Clear search"
            >
              <span className="flex size-7 items-center justify-center rounded-xs hover:bg-muted">
                <X className="size-4" />
              </span>
            </button>
          )}
        </div>

        {/* Status count indicator */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 font-medium self-end sm:self-center">
          <Filter className="size-3.5 text-caramel" />
          <span>
            Showing <strong className="text-foreground">{filteredOrders.length}</strong>{" "}
            {isFiltered ? `${getFilterDisplayName(activeFilter)} ` : ""}orders
          </span>
          {isFiltered && (
            <button
              type="button"
              onClick={() => onSelectFilter("ALL")}
              className="ml-1 text-[11px] text-caramel hover:underline cursor-pointer font-semibold"
            >
              (Clear filter)
            </button>
          )}
        </div>
      </div>

      {/* Order Cards List (Primary status filtering is controlled via the Summary Cards above) */}
      {filteredOrders.length === 0 ? (
        <div className="rounded-sm border border-border bg-card p-8 text-center space-y-2">
          <AlertCircle className="size-8 text-muted-foreground/60 mx-auto" />
          <h3 className="font-heading text-base font-semibold text-foreground">
            No orders found
          </h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            {searchQuery
              ? `No orders matching "${searchQuery}". Try searching with a different term.`
              : isFiltered
              ? `There are no ${getFilterDisplayName(activeFilter)} orders for this selected date.`
              : "There are no orders taken/created for this selected date."}
          </p>
          {isFiltered && (
            <button
              type="button"
              onClick={() => onSelectFilter("ALL")}
              className="mt-2 inline-flex h-8 items-center justify-center rounded-sm border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
            >
              Show all orders for this date
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredOrders.map((order) => {
            const isSelected = selectedOrderId === order.id;
            const isToday = getIstDateString(order.requested_pickup_at) === todayIst;
            const hasCakeMessage = order.order_items?.some(
              (item) => Boolean(item.cake_message)
            );
            const hasCustomerNotes = Boolean(order.customer_notes?.trim());

            return (
              <div
                key={order.id}
                onClick={() => onSelectOrder(order)}
                className={`group cursor-pointer rounded-sm border p-4 transition-all ${
                  isSelected
                    ? "border-caramel bg-caramel/5 ring-1 ring-caramel"
                    : "border-border bg-card hover:border-caramel/50 hover:bg-surface"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  {/* Left: Order #, Customer, Time */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {order.order_number}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide border ${getStatusBadge(
                          order.status
                        )}`}
                      >
                        {formatOrderStatusLabel(order.status)}
                      </span>
                      {isToday && (
                        <span className="rounded bg-caramel/10 text-caramel text-[10px] font-bold px-1.5 py-0.5 uppercase">
                          Today
                        </span>
                      )}
                      {hasCakeMessage && (
                        <span className="rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-semibold px-1.5 py-0.5 inline-flex items-center gap-0.5 dark:bg-amber-950 dark:text-amber-300">
                          <Sparkles className="size-2.5" />
                          <span>Custom Message</span>
                        </span>
                      )}
                      {hasCustomerNotes && (
                        <span className="rounded bg-sky-50 text-sky-900 border border-sky-200 text-[10px] font-semibold px-1.5 py-0.5 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800">
                          Customer Notes
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="font-semibold text-foreground">
                        {order.customer_name}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Phone className="size-3" />
                        {order.customer_phone}
                      </span>
                    </div>
                  </div>

                  {/* Right: Scheduled Pickup Slot & Total */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/50">
                    <div className="text-left sm:text-right">
                      <div className="flex items-center gap-1.5 text-xs text-foreground font-medium sm:justify-end">
                        <Clock className="size-3.5 text-caramel shrink-0" />
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                          Pickup:
                        </span>
                        <span>
                          {formatIstDate(order.requested_pickup_at)},{" "}
                          {formatIstTime(order.requested_pickup_at)}
                        </span>
                      </div>
                      <span className="font-heading text-sm font-bold text-foreground block mt-0.5">
                        {formatPaise(order.total_paise)}
                      </span>
                    </div>

                    <ChevronRight className="size-4 text-muted-foreground group-hover:text-caramel transition-colors" />
                  </div>
                </div>

                {/* Items Summary Line */}
                <div className="mt-2.5 pt-2 border-t border-border/40 text-xs text-muted-foreground flex items-center justify-between">
                  <span className="truncate pr-2">
                    {order.order_items?.length || 0} item(s):{" "}
                    {order.order_items
                      ?.map((i) => {
                        const variant = formatOrderItemVariant(i);
                        return `${i.quantity}x ${i.product_name}${
                          variant ? ` (${variant})` : ""
                        }`;
                      })
                      .join(", ")}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] font-bold uppercase ${
                      order.payment_status === "paid"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {order.payment_status === "paid" ? "Paid" : "Pay at Store"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
