import type { CustomCakeRequest } from "@/lib/custom-cake/types";
import { getIstDateString } from "@/lib/utils/date";
import { getOrderPickupDateIst } from "./summary";
import type { StaffOrder } from "./types";

export interface DateRolloverInput {
  previousToday: string;
  currentToday: string;
  followingOrdersToday: boolean;
  followingCustomCakesToday: boolean;
  selectedOrderId: string | null;
  selectedCustomCakeId: string | null;
  orders: Array<
    Pick<StaffOrder, "id" | "confirmed_pickup_at" | "requested_pickup_at">
  >;
  customCakeRequests: Array<Pick<CustomCakeRequest, "id" | "created_at">>;
}

export interface DateRolloverResult {
  todayIst: string;
  /** Present only when the orders view was following "today" */
  orders: { selectedDate: string; selectedOrderId: string | null } | null;
  /** Present only when the custom cake view was following "today" */
  customCakes: { selectedDate: string; selectedId: string | null } | null;
  shouldRefresh: boolean;
  shouldClearUrlSelection: boolean;
}

/**
 * Pure decision for an IST (Asia/Kolkata) midnight rollover (#80). Returns null when
 * the date has not changed. Views pinned to an explicit date are left alone; views
 * following "today" advance, and drop a selection that no longer belongs to the new day.
 */
export function resolveDateRollover(
  input: DateRolloverInput
): DateRolloverResult | null {
  if (!input.currentToday || !input.previousToday || input.previousToday === input.currentToday) return null;

  const today = input.currentToday;
  let droppedSelection = false;

  let orders: DateRolloverResult["orders"] = null;
  if (input.followingOrdersToday) {
    const stillValid =
      input.selectedOrderId !== null &&
      input.orders.some(
        (o) =>
          o.id === input.selectedOrderId && getOrderPickupDateIst(o) === today
      );
    if (input.selectedOrderId !== null && !stillValid) droppedSelection = true;
    orders = {
      selectedDate: today,
      selectedOrderId: stillValid ? input.selectedOrderId : null,
    };
  }

  let customCakes: DateRolloverResult["customCakes"] = null;
  if (input.followingCustomCakesToday) {
    const stillValid =
      input.selectedCustomCakeId !== null &&
      input.customCakeRequests.some(
        (r) =>
          r.id === input.selectedCustomCakeId &&
          getIstDateString(r.created_at) === today
      );
    if (input.selectedCustomCakeId !== null && !stillValid) {
      droppedSelection = true;
    }
    customCakes = {
      selectedDate: today,
      selectedId: stillValid ? input.selectedCustomCakeId : null,
    };
  }

  return {
    todayIst: today,
    orders,
    customCakes,
    shouldRefresh: orders !== null || customCakes !== null,
    shouldClearUrlSelection: droppedSelection,
  };
}

/**
 * Unread badge for the Custom Cakes tab (#104). A null lastSeen means the stored value
 * is not known yet (server render, or before it has been seeded), which must render the
 * same as "nothing unread" so hydration matches.
 */
export function hasUnreadCustomCakes(input: {
  activeTab: "ORDERS" | "CUSTOM_CAKES" | "ORDER_HISTORY";
  lastSeen: number | null;
  requests: Array<{ created_at: string }>;
}): boolean {
  if (input.activeTab === "CUSTOM_CAKES") return false;
  if (input.lastSeen === null) return false;
  const latest = input.requests[0];
  if (!latest?.created_at) return false;
  const latestTime = new Date(latest.created_at).getTime();
  if (Number.isNaN(latestTime)) return false;
  return latestTime > input.lastSeen;
}

/** First visit: requests already in the queue count as seen; only later ones are unread. */
export function resolveInitialLastSeen(
  latestCreatedAt: string | undefined,
  nowMs: number
): number {
  if (!latestCreatedAt) return nowMs;
  const parsed = new Date(latestCreatedAt).getTime();
  return Number.isNaN(parsed) ? nowMs : parsed;
}
