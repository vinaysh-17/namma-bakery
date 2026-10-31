"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limiter";
import { requireStaffSession } from "./auth";
import type { OrderStatus } from "@/lib/orders/types";

export interface ActionState {
  error?: string | null;
  success?: boolean;
}

/**
 * Signs in a staff member and ensures they have active staff privileges in `staff_roles`.
 */
export async function staffLoginAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Please enter both email and password." };
  }

  // 1. IP-level brute-force rate limit (5 attempts per 5 minutes)
  const clientIp = await getClientIp();
  const loginLimit = checkRateLimit({
    key: `staff_login:ip:${clientIp}`,
    maxRequests: 5,
    windowMs: 5 * 60 * 1000,
  });

  if (!loginLimit.allowed) {
    return {
      error: `Too many login attempts. Please wait ${loginLimit.retryAfterSeconds} seconds before trying again.`,
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return { error: "Invalid email or password. Please try again." };
    }

    // Explicitly verify active staff role in staff_roles
    const { data: roleRow, error: roleError } = await supabase
      .from("staff_roles")
      .select("role, is_active")
      .eq("user_id", data.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (roleError || !roleRow) {
      // Non-staff user attempting to access staff portal: sign out immediately
      await supabase.auth.signOut();
      return {
        error:
          "Access denied. Only authorized bakery staff members can access the staff dashboard.",
      };
    }

    // Record staff login in audit_logs
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const adminClient = createAdminClient();
      await adminClient.from("audit_logs").insert({
        actor_id: data.user.id,
        actor_role: roleRow.role,
        action: "STAFF_LOGIN",
        entity_type: "staff_session",
        entity_id: email,
        after_data: {
          email,
          role: roleRow.role,
          ip: clientIp,
          logged_in_at: new Date().toISOString(),
        },
      });
    } catch (auditErr) {
      console.warn("[staffLoginAction] Failed to record login audit:", auditErr);
    }
  } catch (err) {
    console.error("[staffLoginAction] Login error:", err);
    return { error: "An unexpected error occurred. Please try again later." };
  }

  redirect("/staff");
}

/**
 * Signs out the current staff user and redirects to the staff login page.
 */
export async function staffSignOutAction(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[staffSignOutAction] Sign out error:", err);
  }
  redirect("/staff/login");
}

/**
 * Signs out the current portal user (Admin or Staff) and redirects to the public bakery homepage.
 */
export async function portalSignOutToHomeAction(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[portalSignOutToHomeAction] Sign out error:", err);
  }
  redirect("/");
}

/**
 * Server action to transition order status using the database RPC `transition_order`.
 * Enforces staff privileges and maps database error codes to clear staff messages.
 */
export async function transitionOrderAction(params: {
  orderId: string;
  toStatus: OrderStatus;
  note?: string;
  estimatedReadyAt?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireStaffSession();
    if (!session.isStaff) {
      return { success: false, error: "Forbidden: Staff privileges required." };
    }

    const supabase = await createClient();

    // If order is currently in ACCEPTED and moving to READY_FOR_PICKUP,
    // transition through PREPARING first to satisfy database constraints safely.
    if (params.toStatus === "READY_FOR_PICKUP") {
      const { data: currentOrder } = await supabase
        .from("orders")
        .select("status")
        .eq("id", params.orderId)
        .maybeSingle();

      if (currentOrder?.status === "ACCEPTED") {
        await supabase.rpc("transition_order", {
          p_order_id: params.orderId,
          p_to: "PREPARING",
          p_note: "Order confirmed and moved to preparation",
          p_estimated_ready_at: null,
        });
      }
    }

    let { error } = await supabase.rpc("transition_order", {
      p_order_id: params.orderId,
      p_to: params.toStatus,
      p_note: params.note?.trim() || null,
      p_estimated_ready_at: params.estimatedReadyAt || null,
    });

    // If database function requires an estimated ready time, fallback to requested_pickup_at
    if (
      error &&
      error.message.includes("ESTIMATED_READY_TIME_REQUIRED") &&
      !params.estimatedReadyAt
    ) {
      const { data: orderData } = await supabase
        .from("orders")
        .select("requested_pickup_at")
        .eq("id", params.orderId)
        .maybeSingle();

      const retryRes = await supabase.rpc("transition_order", {
        p_order_id: params.orderId,
        p_to: params.toStatus,
        p_note: params.note?.trim() || null,
        p_estimated_ready_at: orderData?.requested_pickup_at || null,
      });
      error = retryRes.error;
    }

    if (error) {
      console.error("[transitionOrderAction] Transition RPC error:", error.message);
      if (error.message.includes("REASON_REQUIRED")) {
        return { success: false, error: "A note/reason is required for this status change." };
      }
      if (error.message.includes("ESTIMATED_READY_TIME_REQUIRED")) {
        return {
          success: false,
          error: "Could not accept order without estimated ready time.",
        };
      }
      if (error.message.includes("INVALID_TRANSITION")) {
        return {
          success: false,
          error: "Invalid status transition. Orders must follow the approved workflow.",
        };
      }
      if (error.message.includes("admin only")) {
        return {
          success: false,
          error: "This transition requires Administrator authorization.",
        };
      }
      return {
        success: false,
        error: "Failed to update order status. Please review details and try again.",
      };
    }

    revalidatePath("/staff");
    return { success: true };
  } catch (err) {
    console.error("[transitionOrderAction] Execution failure:", err);
    return {
      success: false,
      error: "Failed to update order status. Please check connectivity and try again.",
    };
  }
}

/**
 * Server action to record an in-store counter payment and finalize customer handover
 * in a single operation. If order is already paid, completes handover directly.
 */
export async function completeOrderAndRecordPaymentAction(params: {
  orderId: string;
  note?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireStaffSession();
    if (!session.isStaff) {
      return { success: false, error: "Forbidden: Staff privileges required." };
    }

    const supabase = await createClient();

    // Verify order exists and is eligible for completion
    const { data: order, error: fetchErr } = await supabase
      .from("orders")
      .select("id, status, payment_status, total_paise")
      .eq("id", params.orderId)
      .maybeSingle();

    if (fetchErr || !order) {
      return { success: false, error: "Order not found." };
    }

    if (order.status !== "READY_FOR_PICKUP") {
      return {
        success: false,
        error: "Order must be ready for pickup before completing handover.",
      };
    }

    // 1. Record payment if unpaid
    if (order.payment_status !== "paid") {
      const { error: payErr } = await supabase.rpc("record_store_payment", {
        p_order_id: params.orderId,
        p_amount_paise: order.total_paise,
      });

      if (payErr && !payErr.message.includes("ALREADY_PAID")) {
        console.error(
          "[completeOrderAndRecordPaymentAction] Payment RPC error:",
          payErr.message
        );
        return {
          success: false,
          error: "Failed to record payment for this order. Please try again.",
        };
      }
    }

    // 2. Transition order to COMPLETED
    const { error: transErr } = await supabase.rpc("transition_order", {
      p_order_id: params.orderId,
      p_to: "COMPLETED",
      p_note: params.note?.trim() || "Handover completed at bakery counter",
      p_estimated_ready_at: null,
    });

    if (transErr) {
      console.error(
        "[completeOrderAndRecordPaymentAction] Handover transition error:",
        transErr.message
      );
      return {
        success: false,
        error: "Failed to mark order as completed. Please try again.",
      };
    }

    revalidatePath("/staff");
    return { success: true };
  } catch (err) {
    console.error("[completeOrderAndRecordPaymentAction] Execution failure:", err);
    return {
      success: false,
      error: "Failed to complete handover. Please try again.",
    };
  }
}

/**
 * Server action to record an in-store counter payment using the database RPC `record_store_payment`.
 */
export async function recordStorePaymentAction(params: {
  orderId: string;
  amountPaise: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireStaffSession();
    if (!session.isStaff) {
      return { success: false, error: "Forbidden: Staff privileges required." };
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("record_store_payment", {
      p_order_id: params.orderId,
      p_amount_paise: params.amountPaise,
    });

    if (error) {
      console.error("[recordStorePaymentAction] Payment RPC error:", error.message);
      if (error.message.includes("ORDER_NOT_READY_FOR_PAYMENT")) {
        return {
          success: false,
          error: "Payment can only be recorded when the order is ready for pickup or completed.",
        };
      }
      if (error.message.includes("ALREADY_PAID")) {
        return { success: false, error: "This order is already marked as paid." };
      }
      return {
        success: false,
        error: "Failed to record payment. Please try again.",
      };
    }

    revalidatePath("/staff");
    return { success: true };
  } catch (err) {
    console.error("[recordStorePaymentAction] Execution failure:", err);
    return {
      success: false,
      error: "Failed to record payment. Please try again.",
    };
  }
}

/**
 * Server action to add an internal bakery staff note on an order.
 */
export async function addInternalNoteAction(params: {
  orderId: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireStaffSession();
    if (!session.isStaff || !session.user) {
      return { success: false, error: "Forbidden: Staff privileges required." };
    }

    const trimmed = params.body.trim();
    if (!trimmed || trimmed.length > 1000) {
      return {
        success: false,
        error: "Note must be between 1 and 1000 characters.",
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("order_internal_notes").insert({
      order_id: params.orderId,
      author_id: session.user.id,
      body: trimmed,
    });

    if (error) {
      console.error("[addInternalNoteAction] Database error:", error.message);
      return { success: false, error: "Failed to save internal note." };
    }

    revalidatePath("/staff");
    return { success: true };
  } catch (err) {
    console.error("[addInternalNoteAction] Execution failure:", err);
    return { success: false, error: "Failed to save note." };
  }
}
