import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StaffOrder } from "./types";

/**
 * Fetches recent orders for the staff dashboard using the authenticated staff session.
 *
 * Constrained by RLS policy `orders_read` which verifies `is_staff()`.
 */
export async function getStaffOrders(options?: {
  limit?: number;
}): Promise<{
  orders: StaffOrder[];
  error: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("orders")
      .select(`
        id,
        order_number,
        customer_id,
        customer_name,
        customer_phone,
        customer_email,
        status,
        payment_status,
        payment_method,
        requested_pickup_at,
        confirmed_pickup_at,
        estimated_ready_at,
        total_paise,
        customer_notes,
        bakery_note,
        rejection_reason,
        cancellation_reason,
        cancelled_by,
        custom_request_id,
        created_at,
        updated_at,
        completed_at,
        order_items (
          id,
          order_id,
          product_id,
          variant_id,
          product_name,
          variant_label,
          egg_type,
          finish,
          weight_grams,
          unit_price_paise,
          quantity,
          line_total_paise,
          cake_message
        ),
        order_status_history (
          id,
          order_id,
          from_status,
          to_status,
          changed_by,
          actor_role,
          note,
          created_at
        ),
        order_internal_notes (
          id,
          order_id,
          author_id,
          body,
          created_at
        )
      `)
      .order("created_at", { ascending: false })
      .limit(options?.limit ?? 500);

    if (error) {
      console.error("[getStaffOrders] Database error fetching orders:", error.message);
      return { orders: [], error: error.message };
    }

    return { orders: (data as unknown as StaffOrder[]) ?? [], error: null };
  } catch (err) {
    console.error("[getStaffOrders] Unexpected execution failure:", err);
    return {
      orders: [],
      error: "Failed to load orders. Please refresh or verify connection.",
    };
  }
}

export { calculateOperationalSummary } from "./summary";

/**
 * Fetches recent custom cake enquiries for the staff dashboard using the authenticated staff session.
 *
 * Constrained by RLS policy `requests_read` which verifies `is_staff()`.
 */
export async function getStaffCustomCakeRequests(options?: {
  limit?: number;
}): Promise<{
  requests: import("@/lib/custom-cake/types").CustomCakeRequest[];
  error: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("custom_cake_requests")
      .select(`
        id,
        request_number,
        public_token,
        customer_id,
        customer_name,
        customer_phone,
        customer_email,
        flavour,
        egg_type,
        weight_grams,
        shape,
        cake_type,
        message_on_cake,
        description,
        preferred_pickup_at,
        additional_notes,
        status,
        decline_reason,
        created_at,
        updated_at,
        custom_cake_images (
          id,
          request_id,
          storage_path,
          mime_type,
          size_bytes,
          created_at
        ),
        custom_cake_quotes (
          id,
          request_id,
          price_paise,
          estimated_prep_minutes,
          confirmed_pickup_at,
          bakery_note,
          valid_until,
          created_at
        ),
        request_messages (
          id,
          request_id,
          sender,
          staff_id,
          body,
          created_at
        )
      `)
      .order("created_at", { ascending: false })
      .limit(options?.limit ?? 100);

    if (error) {
      console.error("[getStaffCustomCakeRequests] Database error:", error.message);
      return { requests: [], error: error.message };
    }

    return {
      requests: (data as unknown as import("@/lib/custom-cake/types").CustomCakeRequest[]) ?? [],
      error: null,
    };
  } catch (err) {
    console.error("[getStaffCustomCakeRequests] Execution failure:", err);
    return {
      requests: [],
      error: "Failed to load custom cake enquiries.",
    };
  }
}

/**
 * Calculates operational summary metrics for custom cake enquiries.
 */
export { calculateCustomCakeSummary } from "./summary";
