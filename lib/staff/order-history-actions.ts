"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStaffSession } from "./auth";
import type { StaffOrder } from "./types";
import type { CustomCakeRequest } from "@/lib/custom-cake/types";
import type { HistoryItemList } from "@/lib/admin/order-history-types";

/**
 * READ-ONLY order history for staff and admins.
 *
 * There is intentionally no write/delete operation in this file. Every call requires an
 * active staff session (checked here and again by is_staff() / RLS in the database) and
 * uses the caller's own Supabase session - never the service-role client.
 */

type Result<T> = { success: boolean; error?: string; data?: T };

const NOT_ALLOWED = "You are not authorized to view order history.";

const listSchema = z
  .object({
    from: z.string().datetime({ offset: true }).nullable(),
    to: z.string().datetime({ offset: true }).nullable(),
    type: z.enum(["all", "normal", "custom"]),
  })
  .strict();

const detailSchema = z
  .object({ kind: z.enum(["normal", "custom"]), id: z.string().uuid() })
  .strict();

export type HistoryDetail =
  | { kind: "normal"; order: StaffOrder }
  | { kind: "custom"; request: CustomCakeRequest; linkedOrder: StaffOrder | null };

const ORDER_SELECT = `
  id, order_number, customer_id, customer_name, customer_phone, customer_email,
  status, payment_status, payment_method, requested_pickup_at, confirmed_pickup_at,
  estimated_ready_at, total_paise, customer_notes, bakery_note, rejection_reason,
  cancellation_reason, cancelled_by, custom_request_id, created_at, updated_at, completed_at,
  order_items (id, order_id, product_id, variant_id, product_name, variant_label, egg_type,
    finish, weight_grams, unit_price_paise, quantity, line_total_paise, cake_message),
  order_status_history (id, order_id, from_status, to_status, changed_by, actor_role, note, created_at),
  order_internal_notes (id, order_id, author_id, body, created_at)
`;

const REQUEST_SELECT = `
  id, request_number, public_token, customer_id, customer_name, customer_phone, customer_email,
  flavour, egg_type, weight_grams, shape, cake_type, message_on_cake, description,
  preferred_pickup_at, additional_notes, status, decline_reason, created_at, updated_at,
  custom_cake_images (id, request_id, storage_path, mime_type, size_bytes, created_at),
  custom_cake_quotes (id, request_id, price_paise, estimated_prep_minutes, confirmed_pickup_at,
    bakery_note, valid_until, created_at),
  request_messages (id, request_id, sender, staff_id, body, created_at)
`;

async function assertStaff(): Promise<boolean> {
  const session = await getStaffSession();
  return Boolean(session.isStaff);
}

export async function listStaffOrderHistoryAction(
  input: z.input<typeof listSchema>
): Promise<Result<HistoryItemList>> {
  try {
    if (!(await assertStaff())) return { success: false, error: NOT_ALLOWED };
    const parsed = listSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid date range." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("staff_list_order_history", {
      p_from: parsed.data.from,
      p_to: parsed.data.to,
      p_type: parsed.data.type,
      p_limit: 300,
    });
    if (error) {
      console.error("[orderHistory] staff list failed:", error.code, error.message);
      if (error.code === "42501") return { success: false, error: NOT_ALLOWED };
      if (error.code === "PGRST202" || error.code === "42883") {
        return {
          success: false,
          error:
            "Order history is not available yet because the latest database update has not been applied. Please contact the developer.",
        };
      }
      return { success: false, error: "Could not load order history. Please try again." };
    }
    return { success: true, data: data as HistoryItemList };
  } catch (err) {
    console.error("[orderHistory] staff list exception:", err);
    return { success: false, error: "Could not load order history. Please try again." };
  }
}

/** Loads one history record for the details panel (only when the user clicks it). */
export async function getHistoryDetailAction(
  input: z.input<typeof detailSchema>
): Promise<Result<HistoryDetail>> {
  try {
    if (!(await assertStaff())) return { success: false, error: NOT_ALLOWED };
    const parsed = detailSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid request." };

    const supabase = await createClient();

    if (parsed.data.kind === "normal") {
      const { data, error } = await supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("id", parsed.data.id)
        .maybeSingle();
      if (error || !data) {
        return { success: false, error: "This order is no longer available." };
      }
      return {
        success: true,
        data: { kind: "normal", order: data as unknown as StaffOrder },
      };
    }

    const { data: request, error: reqError } = await supabase
      .from("custom_cake_requests")
      .select(REQUEST_SELECT)
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (reqError || !request) {
      return { success: false, error: "This custom cake is no longer available." };
    }
    const { data: linked } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("custom_request_id", parsed.data.id)
      .maybeSingle();

    return {
      success: true,
      data: {
        kind: "custom",
        request: request as unknown as CustomCakeRequest,
        linkedOrder: (linked as unknown as StaffOrder | null) ?? null,
      },
    };
  } catch (err) {
    console.error("[orderHistory] detail exception:", err);
    return { success: false, error: "Could not load the details. Please try again." };
  }
}
