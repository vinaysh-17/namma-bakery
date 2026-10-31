"use server";

import { revalidatePath } from "next/cache";
import { requireStaffSession } from "@/lib/staff/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
 *   -> staff_send_quote   (records the agreed price + pickup, -> QUOTED)
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
  confirmedPickupAt: string;
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
    const pickup = new Date(confirmedPickupAt);
    if (Number.isNaN(pickup.getTime()) || pickup.getTime() <= Date.now()) {
      return { success: false, error: "Pickup time must be in the future." };
    }

    const supabase = await createClient();
    const { data: request, error: fetchError } = await supabase
      .from("custom_cake_requests")
      .select("id, status, public_token")
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

    const mapError = (message: string): string => {
      if (message.includes("PICKUP_BEFORE_READY")) {
        return "Pickup time must be in the future.";
      }
      if (message.includes("INVALID_PRICE")) return "Enter a valid agreed price.";
      if (message.includes("DAY_FULL")) {
        return "The custom cake limit for that pickup day has been reached.";
      }
      if (message.includes("INVALID_TRANSITION")) {
        return "This request can no longer be accepted.";
      }
      return "Failed to accept this request. Please try again.";
    };

    if (request.status === "SUBMITTED") {
      const { error } = await supabase.rpc("staff_review_request", {
        p_request_id: requestId,
        p_to: "UNDER_REVIEW",
        p_message: null,
      });
      if (error) {
        console.error("[acceptCustomCakeAsOrderAction] review error:", error.message);
        return { success: false, error: mapError(error.message) };
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
      return { success: false, error: mapError(quoteError.message) };
    }

    const adminClient = createAdminClient();
    const { data: accepted, error: acceptError } = await adminClient.rpc(
      "customer_accept_quote",
      { p_token: request.public_token }
    );
    if (acceptError) {
      console.error("[acceptCustomCakeAsOrderAction] accept error:", acceptError.message);
      return { success: false, error: mapError(acceptError.message) };
    }

    revalidatePath("/staff");
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

    if (
      !storagePath ||
      typeof storagePath !== "string" ||
      !storagePath.startsWith("requests/") ||
      storagePath.includes("..")
    ) {
      return { success: false, error: "Invalid reference image path." };
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
