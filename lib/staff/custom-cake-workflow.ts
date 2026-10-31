import type { CustomCakeRequest } from "@/lib/custom-cake/types";
import type { OrderStatus } from "@/lib/orders/types";
import type { OrderFilter, StaffOrder } from "./types";

/**
 * Staff-facing lifecycle of a custom cake request, expressed with the SAME status
 * vocabulary as the Orders Queue (PENDING -> ACCEPTED -> READY_FOR_PICKUP -> COMPLETED,
 * or REJECTED / CANCELLED). No new backend status exists: this is derived from
 *
 *   1. the linked `orders` row (orders.custom_request_id), once staff accepted the
 *      request and an order was created; otherwise
 *   2. the underlying `custom_cake_requests.status` (enquiry stage).
 */
export type CustomCakeStaffStatus = Extract<
  OrderStatus,
  | "PENDING"
  | "ACCEPTED"
  | "READY_FOR_PICKUP"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED"
  | "NO_SHOW"
>;

export function getCustomCakeStaffStatus(
  request: CustomCakeRequest,
  linkedOrder?: StaffOrder | null
): CustomCakeStaffStatus {
  if (linkedOrder) {
    switch (linkedOrder.status) {
      case "PENDING":
        return "PENDING";
      case "ACCEPTED":
      case "PREPARING":
        return "ACCEPTED";
      case "READY_FOR_PICKUP":
        return "READY_FOR_PICKUP";
      case "COMPLETED":
        return "COMPLETED";
      case "REJECTED":
        return "REJECTED";
      case "NO_SHOW":
        return "NO_SHOW";
      default:
        return "CANCELLED";
    }
  }

  switch (request.status) {
    case "SUBMITTED":
    case "UNDER_REVIEW":
    case "NEEDS_CLARIFICATION":
    case "QUOTED":
      return "PENDING";
    case "CUSTOMER_ACCEPTED":
      // Legacy: confirmed before orders were created for custom cakes (no linked order)
      return "ACCEPTED";
    case "DECLINED":
      return "REJECTED";
    default:
      // CUSTOMER_DECLINED, EXPIRED, WITHDRAWN
      return "CANCELLED";
  }
}

/** Same filter rules as the Orders Queue list. */
export function matchesStaffFilter(
  status: CustomCakeStaffStatus,
  filter: OrderFilter
): boolean {
  switch (filter) {
    case "PENDING":
      return status === "PENDING";
    case "ACCEPTED":
      return status === "ACCEPTED";
    case "READY_FOR_PICKUP":
      return status === "READY_FOR_PICKUP";
    case "COMPLETED":
      return status === "COMPLETED";
    case "CANCELLED_OR_REJECTED":
      return ["CANCELLED", "REJECTED", "NO_SHOW"].includes(status);
    default:
      return true;
  }
}

/** Status badge classes (same palette as the Orders Queue). */
export function getStaffStatusBadgeClass(status: OrderStatus): string {
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
}

/**
 * Summary for the Custom Cake Requests cards (same shape as the Orders summary).
 * - totalToday/accepted/readyForPickup/completed/cancelledOrRejected: requests created
 *   on the selected IST date.
 * - pending: GLOBAL — every request still PENDING across all dates (matches the nav badge).
 */
export function calculateCustomCakeOrderSummary(
  items: { created_at: string; staffStatus: CustomCakeStaffStatus }[],
  selectedDate: string,
  getDate: (iso: string) => string
) {
  const summary = {
    totalToday: 0,
    pending: 0,
    accepted: 0,
    preparing: 0,
    readyForPickup: 0,
    completed: 0,
    cancelledOrRejected: 0,
  };
  for (const item of items) {
    if (item.staffStatus === "PENDING") summary.pending++;
    if (getDate(item.created_at) !== selectedDate) continue;
    summary.totalToday++;
    switch (item.staffStatus) {
      case "ACCEPTED":
        summary.accepted++;
        break;
      case "READY_FOR_PICKUP":
        summary.readyForPickup++;
        break;
      case "COMPLETED":
        summary.completed++;
        break;
      case "REJECTED":
      case "CANCELLED":
      case "NO_SHOW":
        summary.cancelledOrRejected++;
        break;
    }
  }
  return summary;
}
