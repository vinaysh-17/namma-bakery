"use server";

import { revalidatePath } from "next/cache";
import { requireStaffSession } from "@/lib/staff/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyCustomRequestChanged } from "@/lib/realtime/broadcast";
import type { CustomCakeStatus } from "./types";

/**
 * Updates a custom cake request status with staff authorization.
 */
export async function updateCustomCakeStatusAction(params: {
  requestId: string;
  toStatus: CustomCakeStatus;
  message?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireStaffSession();
    if (!session.isStaff) {
      return { success: false, error: "Unauthorized: Staff privileges required." };
    }

    const { requestId, toStatus, message } = params;

    // If using the database RPC transitions
    if (
      toStatus === "UNDER_REVIEW" ||
      toStatus === "NEEDS_CLARIFICATION" ||
      toStatus === "DECLINED" ||
      toStatus === "CUSTOMER_ACCEPTED"
    ) {
      const supabase = await createClient();
      const { error } = await supabase.rpc("staff_review_request", {
        p_request_id: requestId,
        p_to: toStatus,
        p_message: message?.trim() || null,
      });

      if (error) {
        console.error("[updateCustomCakeStatusAction] RPC error:", error.message);
        if (error.message.includes("MESSAGE_REQUIRED")) {
          return {
            success: false,
            error: "A note or explanation is required for this status change.",
          };
        }
        return {
          success: false,
          error: "Failed to update custom cake status. Please try again.",
        };
      }
    } else {
      // Direct administrative update (e.g. manual confirmation or cancellation)
      const adminClient = createAdminClient();
      const { error: updateError } = await adminClient
        .from("custom_cake_requests")
        .update({
          status: toStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (updateError) {
        console.error("[updateCustomCakeStatusAction] Update error:", updateError.message);
        return { success: false, error: "Failed to update custom cake status. Please try again." };
      }

      // Record message if provided
      if (message?.trim()) {
        await adminClient.from("request_messages").insert({
          request_id: requestId,
          sender: "STAFF",
          staff_id: session.user?.id,
          body: message.trim(),
        });
      }

      // Log in audit_logs
      await adminClient.from("audit_logs").insert({
        actor_id: session.user?.id,
        actor_role: session.role || "STAFF",
        action: "custom_cake.status_changed",
        entity_type: "custom_cake_requests",
        entity_id: requestId,
        after_data: { to: toStatus, note: message },
      });
    }

    revalidatePath("/staff");
    await notifyCustomRequestChanged(requestId);
    return { success: true };
  } catch (err) {
    console.error("[updateCustomCakeStatusAction] Execution failure:", err);
    return {
      success: false,
      error: "An unexpected error occurred. Please try again.",
    };
  }
}

/**
 * Accepts a custom cake request as an order, using the existing quote workflow end to end:
 *   staff_review_request (-> UNDER_REVIEW, if needed)
 *   -> staff_send_quote   (records the agreed price + the CUSTOMER requested pickup, -> QUOTED)
 *   -> customer_accept_quote (service role; creates the linked `orders` row in ACCEPTED,
 *      with its order item, status history, and sets the request to CUSTOMER_ACCEPTED)
 *
 * After this the request is driven by the normal order actions (ready for pickup,
 * collect payment & handover, cancel) on the linked order. Each RPC re-validates state,
 * and customer_accept_quote only accepts a QUOTED request, so a double submit cannot
 * create a second order (orders.custom_request_id is also unique).
 */
export async function acceptCustomCakeAsOrderAction(params: {
  requestId: string;
  pricePaise: number;
  /** Optional staff-confirmed pickup/ready time (ISO). Empty => customer's requested pickup. */
  confirmedPickupAt?: string | null;
  note?: string;
}): Promise<{ success: boolean; error?: string; orderNumber?: string }> {
  try {
    const session = await requireStaffSession();
    if (!session.isStaff) {
      return { success: false, error: "Unauthorized: Staff privileges required." };
    }

    const { requestId, pricePaise, confirmedPickupAt, note } = params;
    if (
      !Number.isInteger(pricePaise) ||
      pricePaise <= 0 ||
      pricePaise > 10_000_000
    ) {
      return { success: false, error: "Enter a valid agreed price." };
    }
    const supabase = await createClient();
    const { data: request, error: fetchError } = await supabase
      .from("custom_cake_requests")
      .select("id, status, public_token, preferred_pickup_at")
      .eq("id", requestId)
      .maybeSingle();

    if (fetchError || !request) {
      return { success: false, error: "Request not found." };
    }
    if (request.status === "CUSTOMER_ACCEPTED") {
      return { success: false, error: "This request has already been accepted." };
    }
    if (
      !["SUBMITTED", "UNDER_REVIEW", "NEEDS_CLARIFICATION", "QUOTED"].includes(
        request.status
      )
    ) {
      return { success: false, error: "This request can no longer be accepted." };
    }

    // Schedule: use the staff-confirmed time only when provided; otherwise keep the
    // customer's requested pickup. No default or invented time is ever substituted.
    const staffConfirmed = confirmedPickupAt?.trim()
      ? new Date(confirmedPickupAt)
      : null;
    if (staffConfirmed && Number.isNaN(staffConfirmed.getTime())) {
      return { success: false, error: "The confirmed pickup time is not valid." };
    }
    const pickup = staffConfirmed ?? new Date(request.preferred_pickup_at);
    if (Number.isNaN(pickup.getTime())) {
      return { success: false, error: "This request has no valid pickup time." };
    }
    if (pickup.getTime() <= Date.now()) {
      return {
        success: false,
        error: staffConfirmed
          ? "The confirmed pickup time must be in the future."
          : "The customer's requested pickup time has already passed. Enter a new Confirmed Pickup / Ready Time to accept this request.",
      };
    }

    const mapError = (message: string, code?: string): string => {
      // 42702 = ambiguous column reference inside customer_accept_quote (fixed by
      // migration 0010). Say so explicitly instead of a generic failure.
      if (code === "42702" || message.includes("is ambiguous")) {
        return "Database migration 0010 (customer_accept_quote fix) has not been applied. Run supabase/migrations/0010_fix_customer_accept_quote_ambiguity.sql in the Supabase SQL editor, then try again.";
      }
      if (message.includes("PICKUP_BEFORE_READY")) {
        return "The pickup time must be in the future.";
      }
      if (message.includes("INVALID_PRICE")) return "Enter a valid agreed price.";
      if (message.includes("DAY_FULL")) {
        return "The custom cake limit for that pickup day has been reached.";
      }
      if (message.includes("INVALID_TRANSITION")) {
        return "This request can no longer be accepted.";
      }
      return `Failed to accept this request (database error${code ? " " + code : ""}). Please try again.`;
    };

    if (request.status === "SUBMITTED") {
      const { error } = await supabase.rpc("staff_review_request", {
        p_request_id: requestId,
        p_to: "UNDER_REVIEW",
        p_message: null,
      });
      if (error) {
        console.error("[acceptCustomCakeAsOrderAction] review error:", error.message);
        return { success: false, error: mapError(error.message, error.code) };
      }
    }

    const { error: quoteError } = await supabase.rpc("staff_send_quote", {
      p_request_id: requestId,
      p_price_paise: pricePaise,
      p_prep_minutes: 0,
      p_confirmed_pickup: pickup.toISOString(),
      p_note: note?.trim() || null,
    });
    if (quoteError) {
      console.error("[acceptCustomCakeAsOrderAction] quote error:", quoteError.message);
      return { success: false, error: mapError(quoteError.message, quoteError.code) };
    }

    const adminClient = createAdminClient();
    const { data: accepted, error: acceptError } = await adminClient.rpc(
      "customer_accept_quote",
      { p_token: request.public_token }
    );
    if (acceptError) {
      console.error("[acceptCustomCakeAsOrderAction] accept error:", acceptError.message);
      return { success: false, error: mapError(acceptError.message, acceptError.code) };
    }

    revalidatePath("/staff");
    await notifyCustomRequestChanged(requestId);
    const row = Array.isArray(accepted) ? accepted[0] : accepted;
    return { success: true, orderNumber: row?.order_number };
  } catch (err) {
    console.error("[acceptCustomCakeAsOrderAction] Execution failure:", err);
    return {
      success: false,
      error: "An unexpected error occurred. Please try again.",
    };
  }
}

/**
 * Adds an internal staff note or customer message on a custom cake enquiry.
 */
export async function addCustomCakeStaffNoteAction(params: {
  requestId: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireStaffSession();
    if (!session.isStaff || !session.user) {
      return { success: false, error: "Unauthorized: Staff privileges required." };
    }

    const trimmed = params.body.trim();
    if (!trimmed || trimmed.length > 1000) {
      return {
        success: false,
        error: "Message must be between 1 and 1,000 characters.",
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("post_request_message_staff", {
      p_request_id: params.requestId,
      p_body: trimmed,
    });

    if (error) {
      console.error("[addCustomCakeStaffNoteAction] Error:", error.message);
      return { success: false, error: "Failed to post staff note." };
    }

    revalidatePath("/staff");
    await notifyCustomRequestChanged(params.requestId);
    return { success: true };
  } catch (err) {
    console.error("[addCustomCakeStaffNoteAction] Execution failure:", err);
    return { success: false, error: "Failed to add note." };
  }
}

/**
 * Generates a temporary signed URL for staff to view/download a cake reference image.
 */
export async function getCustomCakeSignedUrlAction(
  storagePath: string
): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  try {
    const session = await requireStaffSession();
    if (!session.isStaff) {
      return { success: false, error: "Unauthorized: Staff privileges required." };
    }

    const validPath =
      typeof storagePath === "string" &&
      /^requests\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(storagePath);
    if (!validPath) {
      return { success: false, error: "Invalid reference image path." };
    }

    // Authorise against the database with the caller's own (RLS-scoped) session: the
    // image must belong to a custom cake request this staff/admin user can read. Only
    // then is a short-lived signed URL issued with the service role (bucket stays private).
    const supabase = await createClient();
    const { data: imageRow } = await supabase
      .from("custom_cake_images")
      .select("id")
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (!imageRow) {
      return { success: false, error: "Reference image not found." };
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient.storage
      .from("cake-references")
      .createSignedUrl(storagePath, 3600);

    if (error || !data?.signedUrl) {
      return { success: false, error: "Failed to generate image link." };
    }

    return { success: true, signedUrl: data.signedUrl };
  } catch (err) {
    console.error("[getCustomCakeSignedUrlAction] Execution failure:", err);
    return { success: false, error: "Failed to retrieve image." };
  }
}
