"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalNotifications } from "./queries";
import type { PortalNotification, NotificationType } from "./types";

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
      return { success: false, error: error.message };
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
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("[markAllNotificationsAsReadAction] Unexpected exception:", err);
    return { success: false, error: "Failed to mark all notifications as read." };
  }
}

/**
 * Backend utility to create a portal notification using service role.
 * Useful for backend workflows or explicit notification triggers.
 */
export async function createPortalNotification(params: {
  type: NotificationType;
  title: string;
  message: string;
  link_url: string;
  related_entity_id?: string;
}): Promise<{ success: boolean; notification?: PortalNotification; error?: string }> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("portal_notifications")
      .insert({
        type: params.type,
        title: params.title,
        message: params.message,
        link_url: params.link_url,
        related_entity_id: params.related_entity_id || null,
        is_read: false,
      })
      .select()
      .single();

    if (error) {
      console.error("[createPortalNotification] Insert error:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true, notification: data as PortalNotification };
  } catch (err) {
    console.error("[createPortalNotification] Unexpected exception:", err);
    return { success: false, error: "Failed to create portal notification." };
  }
}

