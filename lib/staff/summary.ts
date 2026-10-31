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
 * When selectedDate is provided, metrics are scoped to enquiries created on that date.
 */
export function calculateCustomCakeSummary(
  requests: CustomCakeRequest[],
  selectedDate?: string
): CustomCakeOperationalSummary {
  const targetDateIst = selectedDate;

  let pending = 0;
  let underReview = 0;
  let quoted = 0;
  let confirmed = 0;
  let declinedOrCancelled = 0;
  let total = 0;

  for (const req of requests) {
    if (targetDateIst) {
      const isTargetDate = getIstDateString(req.created_at) === targetDateIst;
      if (!isTargetDate) continue;
    }

    total++;

    switch (req.status) {
      case "SUBMITTED":
        pending++;
        break;
      case "UNDER_REVIEW":
      case "NEEDS_CLARIFICATION":
        underReview++;
        break;
      case "QUOTED":
        quoted++;
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
