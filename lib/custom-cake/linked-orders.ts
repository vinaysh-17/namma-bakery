import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/lib/orders/types";
import type { CustomCakeLinkedOrder } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

interface LinkedOrderRow {
  custom_request_id: string;
  order_number: string;
  public_token: string;
  status: OrderStatus;
  requested_pickup_at: string | null;
  confirmed_pickup_at: string | null;
}

/**
 * Loads the orders created from these custom cake requests, keyed by request id.
 *
 * The customer pages use them to show the real progress (ready, collected, cancelled,
 * no-show) and the confirmed pickup time. Reading orders needs the column grant from
 * migration 0020. If that read fails, the pages fall back to the request status alone,
 * as they did before, instead of failing to load.
 */
export async function getLinkedOrdersByRequestId(
  adminClient: AdminClient,
  requestIds: string[]
): Promise<Map<string, CustomCakeLinkedOrder>> {
  const byRequest = new Map<string, CustomCakeLinkedOrder>();
  if (requestIds.length === 0) return byRequest;

  const { data, error } = await adminClient
    .from("orders")
    .select(
      "custom_request_id, order_number, public_token, status, requested_pickup_at, confirmed_pickup_at"
    )
    .in("custom_request_id", requestIds);

  if (error) {
    console.error("[getLinkedOrdersByRequestId] Could not load linked orders:", {
      message: error.message,
      code: error.code,
    });
    return byRequest;
  }

  for (const row of (data || []) as LinkedOrderRow[]) {
    byRequest.set(row.custom_request_id, {
      order_number: row.order_number,
      public_token: row.public_token,
      status: row.status,
      pickup_at: row.confirmed_pickup_at || row.requested_pickup_at,
    });
  }
  return byRequest;
}
