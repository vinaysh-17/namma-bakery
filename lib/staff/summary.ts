import { getIstDateString } from "@/lib/utils/date";
import type { OperationalSummary, StaffOrder } from "./types";

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