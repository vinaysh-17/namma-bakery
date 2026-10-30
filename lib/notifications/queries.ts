import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PortalNotification } from "./types";

export interface PortalNotificationsResult {
  notifications: PortalNotification[];
  unreadCount: number;
  error?: string;
}

/**
 * Fetch latest portal notifications and unread count for staff/admin users.
 * Constrained by Row-Level Security (is_staff()).
 */
export async function getPortalNotifications(
  limit = 50
): Promise<PortalNotificationsResult> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("portal_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[getPortalNotifications] Query error:", error.message);
      return { notifications: [], unreadCount: 0, error: error.message };
    }

    const notifications = (data || []) as PortalNotification[];
    const unreadCount = notifications.filter((n) => !n.is_read).length;

    return { notifications, unreadCount };
  } catch (err) {
    console.error("[getPortalNotifications] Unexpected exception:", err);
    return {
      notifications: [],
      unreadCount: 0,
      error: "Failed to retrieve notifications.",
    };
  }
}

