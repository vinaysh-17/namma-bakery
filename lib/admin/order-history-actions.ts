"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertAdminSession } from "./auth";
import { drainCakeReferenceCleanupQueue } from "./order-history-storage";
import {
  TYPED_CONFIRM_THRESHOLD,
  type DeletionPreview,
} from "./order-history-types";

/**
 * Admin-only order history actions.
 *
 * Authorization is enforced twice:
 *  1. assertAdminSession() here (server-side role lookup from the session cookie - nothing
 *     the browser sends is trusted), and
 *  2. is_admin() inside every database function (a staff session that somehow reached the
 *     RPC would still be rejected with 42501).
 * The user-session Supabase client is used on purpose (NOT the service role) so the database
 * sees the real caller.
 */

type Result<T = undefined> = { success: boolean; error?: string; data?: T };

const idsSchema = z.array(z.string().uuid()).min(1).max(1000);

const previewSchema = z.object({ orderIds: idsSchema }).strict();

const deleteSchema = z
  .object({
    orderIds: idsSchema,
    method: z.enum(["individual", "selected", "day", "week", "month", "range"]),
    rangeLabel: z.string().max(80).optional(),
    confirmText: z.string().max(20).optional(),
  })
  .strict();

const NOT_AUTHORIZED = "You are not authorized to delete order history.";

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("Unauthorized")) return "Your session has expired. Please sign in again.";
  if (message.startsWith("Forbidden")) return NOT_AUTHORIZED;
  return "";
}

type Operation = "preview" | "delete";

const FALLBACK: Record<Operation, string> = {
  preview: "Could not prepare the deletion preview. Nothing was deleted.",
  delete: "Order deletion failed. Nothing was deleted.",
};

/**
 * Maps a database error to a safe, specific message. Raw database text, function names
 * and SQL are never returned to the browser (the real error is logged server side).
 */
function mapDbError(
  error: { code?: string; message: string },
  operation: Operation
): string {
  const { code, message } = error;
  if (code === "42501" || message.includes("forbidden") || message.includes("permission denied")) {
    return NOT_AUTHORIZED;
  }
  // Function missing from the schema: the database update for this feature is not applied
  if (code === "PGRST202" || code === "42883") {
    return "Order history is not available yet because the latest database update has not been applied. Please contact the developer.";
  }
  if (message.includes("ORDERS_NOT_ELIGIBLE")) {
    return "Some selected orders are no longer available. Refresh the list and try again. Nothing was deleted.";
  }
  if (message.includes("NOTHING_SELECTED")) {
    return "No eligible historical orders found for this period.";
  }
  if (message.includes("TOO_MANY_ORDERS")) {
    return "Too many orders selected. Please narrow the date range.";
  }
  return FALLBACK[operation];
}

/** Reads the CURRENT database state of the orders that are about to be deleted. */
export async function previewOrderDeletionAction(
  input: z.input<typeof previewSchema>
): Promise<Result<DeletionPreview>> {
  try {
    await assertAdminSession();
    const parsed = previewSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid selection." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_preview_order_deletion", {
      p_order_ids: parsed.data.orderIds,
    });
    if (error) {
      console.error("[orderHistory] preview failed:", error.code, error.message);
      return { success: false, error: mapDbError(error, "preview") };
    }
    return { success: true, data: data as DeletionPreview };
  } catch (err) {
    const known = describeError(err);
    if (!known) console.error("[orderHistory] preview exception:", err);
    return { success: false, error: known || FALLBACK.preview };
  }
}

/** One atomic, authorized database call; either every order is deleted or none. */
export async function deleteOrderHistoryAction(
  input: z.input<typeof deleteSchema>
): Promise<Result<{ deleted: number; warning?: string }>> {
  try {
    await assertAdminSession();
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid selection." };

    const { orderIds, method, rangeLabel, confirmText } = parsed.data;
    const uniqueIds = Array.from(new Set(orderIds));

    // Larger deletions need the typed confirmation (verified here, not only in the dialog)
    if (uniqueIds.length >= TYPED_CONFIRM_THRESHOLD && confirmText !== "DELETE") {
      return { success: false, error: "Type DELETE to confirm this deletion." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_delete_order_history", {
      p_order_ids: uniqueIds,
      p_method: method,
      p_range: rangeLabel ? { label: rangeLabel } : null,
    });
    if (error) {
      console.error("[orderHistory] delete failed:", error.code, error.message);
      return { success: false, error: mapDbError(error, "delete") };
    }

    const deleted = Number((data as { deleted?: number } | null)?.deleted ?? 0);

    // The database delete is committed and the photo paths are queued in the same
    // transaction. Remove the files now (best effort - never reverses the deletion; anything
    // that fails stays queued and is retried).
    const { failed } = await drainCakeReferenceCleanupQueue();
    const warning =
      failed > 0
        ? `${failed} reference photo ${failed === 1 ? "file" : "files"} could not be removed from storage yet; it will be retried automatically.`
        : undefined;

    return { success: true, data: { deleted, warning } };
  } catch (err) {
    const known = describeError(err);
    if (!known) console.error("[orderHistory] delete exception:", err);
    return { success: false, error: known || FALLBACK.delete };
  }
}

/**
 * Removes reference photos left behind by deletions - in particular by the automatic
 * 3-month cleanup, which runs inside the database and can only queue the files. Called by
 * the admin Order History view; admin-only, no input.
 */
export async function cleanupReferencePhotosAction(): Promise<Result<{ removed: number }>> {
  try {
    await assertAdminSession();
    const { removed } = await drainCakeReferenceCleanupQueue();
    return { success: true, data: { removed } };
  } catch {
    return { success: false };
  }
}
