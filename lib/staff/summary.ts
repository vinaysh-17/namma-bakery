import { getIstDateString } from "@/lib/utils/date";
import type { OperationalSummary, StaffOrder } from "./types";
import type {
  CustomCakeRequest,
  CustomCakeOperationalSummary,
} from "@/lib/custom-cake/types";

/**
 * Computes operational summary metrics for a given date in Asia/Kolkata timezone.
 * Scoped to the selected date (defaults to today in IST).
 */
export function calculateOperationalSummary(
  orders: StaffOrder[],
  selectedDate?: string
): OperationalSummary {
  const targetDateIst = selectedDate || getIstDateString();

  let totalToday = 0;
  let pending = 0;
  let accepted = 0;
  let readyForPickup = 0;
  let completed = 0;
  let cancelledOrRejected = 0;

  for (const order of orders) {
    const isTargetDate = getIstDateString(order.created_at) === targetDateIst;
    if (!isTargetDate) continue;

    totalToday++;

    switch (order.status) {
      case "PENDING":
        pending++;
        break;
      case "ACCEPTED":
      case "PREPARING":
        // In simplified workflow, accepted covers in-progress preparation
        accepted++;
        break;
      case "READY_FOR_PICKUP":
        readyForPickup++;
        break;
      case "COMPLETED":
        completed++;
        break;
      case "CANCELLED":
      case "REJECTED":
      case "NO_SHOW":
        cancelledOrRejected++;
        break;
    }
  }

  return {
    totalToday,
    pending,
    accepted,
    preparing: 0,
    readyForPickup,
    completed,
    cancelledOrRejected,
  };
}

/**
 * Calculates operational summary metrics for custom cake enquiries in Asia/Kolkata timezone.
 * Total, in-review, confirmed, and declined metrics are scoped to enquiries created on selectedDate.
 * The Pending Review metric represents the global pending workload across all dates, matching
 * the staff navigation badge.
 */
export function calculateCustomCakeSummary(
  requests: CustomCakeRequest[],
  selectedDate?: string
): CustomCakeOperationalSummary {
  const targetDateIst = selectedDate || getIstDateString();

  // Pending Review represents global pending workload waiting for staff action,
  // consistent with the top navigation badge.
  const pending = (requests || []).filter((r) => r.status === "SUBMITTED").length;

  let underReview = 0;
  let quoted = 0;
  let confirmed = 0;
  let declinedOrCancelled = 0;
  let total = 0;

  for (const req of requests) {
    const isTargetDate = getIstDateString(req.created_at) === targetDateIst;
    if (!isTargetDate) continue;

    total++;

    switch (req.status) {
      case "SUBMITTED":
        // Counted globally in pending
        break;
      case "UNDER_REVIEW":
      case "NEEDS_CLARIFICATION":
        underReview++;
        break;
      case "QUOTED":
        // Quote sent, awaiting customer: still an in-progress enquiry, not confirmed.
        quoted++;
        underReview++;
        break;
      case "CUSTOMER_ACCEPTED":
        confirmed++;
        break;
      case "DECLINED":
      case "CUSTOMER_DECLINED":
      case "EXPIRED":
      case "WITHDRAWN":
        declinedOrCancelled++;
        break;
    }
  }

  return {
    total,
    pending,
    underReview,
    quoted,
    confirmed,
    declinedOrCancelled,
  };
}
