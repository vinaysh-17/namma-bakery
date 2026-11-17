"use server";

import { createClient } from "@/lib/supabase/server";
import { getStaffSession } from "@/lib/staff/auth";
import { getPortalNotifications } from "./queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Server action to get latest notifications and unread count.
 */
export async function getPortalNotificationsAction() {
  return await getPortalNotifications();
}

/**
 * Server action to mark a single notification as read.
 */
export async function markNotificationAsReadAction(id: string) {
  try {
    if (!id || !UUID_RE.test(id)) {
      return { success: false, error: "Failed to mark notification as read." };
    }

    const session = await getStaffSession();
    if (!session.isStaff) {
      return { success: false, error: "Failed to mark notification as read." };
    }

    const supabase = await createClient();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("portal_notifications")
      .update({
        is_read: true,
        read_at: now,
      })
      .eq("id", id);

    if (error) {
      console.error("[markNotificationAsReadAction] Update error:", error.message);
      return { success: false, error: "Failed to mark notification as read." };
    }

    return { success: true };
  } catch (err) {
    console.error("[markNotificationAsReadAction] Unexpected exception:", err);
    return { success: false, error: "Failed to mark notification as read." };
  }
}

/**
 * Server action to mark all notifications as read.
 */
export async function markAllNotificationsAsReadAction() {
  try {
    const session = await getStaffSession();
    if (!session.isStaff) {
      return { success: false, error: "Failed to mark all notifications as read." };
    }

    const supabase = await createClient();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("portal_notifications")
      .update({
        is_read: true,
        read_at: now,
      })
      .eq("is_read", false);

    if (error) {
      console.error("[markAllNotificationsAsReadAction] Update error:", error.message);
      return { success: false, error: "Failed to mark all notifications as read." };
    }

    return { success: true };
  } catch (err) {
    console.error("[markAllNotificationsAsReadAction] Unexpected exception:", err);
    return { success: false, error: "Failed to mark all notifications as read." };
  }
}
