import type { CustomCakeLinkedOrder, CustomCakeStatus } from "./types";

/**
 * What the customer sees for a custom cake, on the tracker and on the confirmation page.
 *
 * Once the bakery accepts a request, an order is created and the request stays
 * CUSTOMER_ACCEPTED for good. From then on the linked order carries the real progress,
 * so it decides the stage. This mirrors the Staff Portal (lib/staff/custom-cake-workflow.ts),
 * so staff and customers see the same thing.
 */
export type CustomCakeCustomerStage =
  | "RECEIVED"
  | "IN_REVIEW"
  | "NEEDS_CLARIFICATION"
  | "CONFIRMED"
  | "READY_FOR_PICKUP"
  | "COLLECTED"
  | "CANCELLED"
  | "NO_SHOW"
  | "CLOSED";

export function getCustomCakeCustomerStage(
  status: CustomCakeStatus,
  order?: CustomCakeLinkedOrder | null
): CustomCakeCustomerStage {
  if (order) {
    switch (order.status) {
      case "PENDING":
      case "ACCEPTED":
      case "PREPARING":
        return "CONFIRMED";
      case "READY_FOR_PICKUP":
        return "READY_FOR_PICKUP";
      case "COMPLETED":
        return "COLLECTED";
      case "NO_SHOW":
        return "NO_SHOW";
      default:
        // CANCELLED, REJECTED
        return "CANCELLED";
    }
  }

  switch (status) {
    case "SUBMITTED":
      return "RECEIVED";
    case "UNDER_REVIEW":
    // QUOTED only exists for a moment while staff accept a request. Without an order,
    // nothing has been confirmed yet.
    case "QUOTED":
      return "IN_REVIEW";
    case "NEEDS_CLARIFICATION":
      return "NEEDS_CLARIFICATION";
    case "CUSTOMER_ACCEPTED":
      // Older requests confirmed before custom cakes created orders.
      return "CONFIRMED";
    default:
      // DECLINED, CUSTOMER_DECLINED, EXPIRED, WITHDRAWN
      return "CLOSED";
  }
}

/** Stages where the cake is no longer going ahead. */
export function isCustomCakeStageClosed(stage: CustomCakeCustomerStage): boolean {
  return stage === "CANCELLED" || stage === "NO_SHOW" || stage === "CLOSED";
}

export function getCustomCakeCustomerBadge(stage: CustomCakeCustomerStage): {
  label: string;
  detail: string;
  style: string;
} {
  switch (stage) {
    case "RECEIVED":
      return {
        label: "Enquiry Received",
        detail: "Pending Review",
        style: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-300",
      };
    case "IN_REVIEW":
      return {
        label: "In Review",
        detail: "Baker Contacting You",
        style: "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950 dark:text-blue-300",
      };
    case "NEEDS_CLARIFICATION":
      return {
        label: "Clarification Needed",
        detail: "Baker Sent A Note",
        style: "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-950 dark:text-purple-300",
      };
    case "CONFIRMED":
      return {
        label: "Confirmed by Bakery",
        detail: "Scheduled for Baking",
        style: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300",
      };
    case "READY_FOR_PICKUP":
      return {
        label: "Ready for Pickup",
        detail: "Collect at the Counter",
        style: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300",
      };
    case "COLLECTED":
      return {
        label: "Collected",
        detail: "Order Complete",
        style: "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900 dark:text-slate-300",
      };
    case "CANCELLED":
      return {
        label: "Order Cancelled",
        detail: "Not Going Ahead",
        style: "bg-destructive/15 text-destructive border-destructive/30",
      };
    case "NO_SHOW":
      return {
        label: "Not Collected",
        detail: "Order Closed",
        style: "bg-destructive/15 text-destructive border-destructive/30",
      };
    case "CLOSED":
      return {
        label: "Request Closed / Declined",
        detail: "Not In Progress",
        style: "bg-destructive/15 text-destructive border-destructive/30",
      };
  }
}

/**
 * The pickup time to show. Once the bakery has confirmed the cake, that is the confirmed
 * time, which staff may have changed from the one the customer asked for.
 */
export function getCustomCakePickup(request: {
  status: CustomCakeStatus;
  preferred_pickup_at: string;
  quote?: { confirmed_pickup_at: string } | null;
  order?: CustomCakeLinkedOrder | null;
}): { at: string; confirmed: boolean; changed: boolean } {
  const confirmedAt =
    request.order?.pickup_at ||
    (request.status === "CUSTOMER_ACCEPTED" ? request.quote?.confirmed_pickup_at : null) ||
    null;
  if (!confirmedAt) {
    return { at: request.preferred_pickup_at, confirmed: false, changed: false };
  }
  return {
    at: confirmedAt,
    confirmed: true,
    changed:
      new Date(confirmedAt).getTime() !== new Date(request.preferred_pickup_at).getTime(),
  };
}
