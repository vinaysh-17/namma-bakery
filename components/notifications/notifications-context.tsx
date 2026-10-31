"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  RealtimeChannel,
  Session,
  AuthChangeEvent,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import {
  markNotificationAsReadAction,
  markAllNotificationsAsReadAction,
} from "@/lib/notifications/actions";
import { playNotificationSound } from "@/lib/notifications/audio";
import type { PortalNotification } from "@/lib/notifications/types";

interface NotificationContextValue {
  notifications: PortalNotification[];
  unreadCount: number;
  isMuted: boolean;
  isOpen: boolean;
  toasts: PortalNotification[];
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  toggleMute: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismissToast: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const STORAGE_KEY_MUTED = "namma_bakery_notifications_muted";

export interface NotificationsProviderProps {
  children: ReactNode;
  initialNotifications?: PortalNotification[];
  initialUnreadCount?: number;
}

export function NotificationsProvider({
  children,
  initialNotifications = [],
  initialUnreadCount = 0,
}: NotificationsProviderProps) {
  const [notifications, setNotifications] = useState<PortalNotification[]>(initialNotifications);
  const [unreadCount, setUnreadCount] = useState<number>(initialUnreadCount);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem(STORAGE_KEY_MUTED) === "true";
      } catch {
        return false;
      }
    }
    return false;
  });
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<PortalNotification[]>([]);

  const knownIdsRef = useRef<Set<string>>(
    new Set((initialNotifications || []).map((n) => n.id))
  );
  const initialLoadedRef = useRef<boolean>(true);
  const isMutedRef = useRef<boolean>(isMuted);

  // Sync ref with mute state
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Synchronize state when server revalidates initialNotifications (e.g. router.refresh or tab nav)
  useEffect(() => {
    if (!initialNotifications) return;

    setNotifications((prev) => {
      const unreadServer = initialNotifications.filter((n) => !n.is_read);
      const existingMap = new Map(prev.map((n) => [n.id, n]));
      let hasChanges = false;

      for (const notif of unreadServer) {
        knownIdsRef.current.add(notif.id);
        if (!existingMap.has(notif.id)) {
          existingMap.set(notif.id, notif);
          hasChanges = true;
        }
      }

      // If any notification in state has been read on the server, remove it
      const serverUnreadIds = new Set(unreadServer.map((n) => n.id));
      for (const id of Array.from(existingMap.keys())) {
        if (!serverUnreadIds.has(id)) {
          existingMap.delete(id);
          hasChanges = true;
        }
      }

      if (!hasChanges) return prev;

      const merged = Array.from(existingMap.values()).sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setUnreadCount(merged.length);
      return merged;
    });
  }, [initialNotifications]);

  // Toggle Mute
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_MUTED, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Realtime subscription lifecycle
  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;

    const setupRealtime = async () => {
      try {
        // 1. Ensure user session access token is attached to Supabase Realtime
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (session?.access_token) {
          await supabase.realtime.setAuth(session.access_token);
        }

        if (!isMounted) return;

        // 2. Clean up any stale channel with this topic if it exists
        const existing = supabase
          .getChannels()
          .find((c: RealtimeChannel) => c.topic === "realtime:portal-notifications-realtime");
        if (existing) {
          await supabase.removeChannel(existing);
        }

        if (!isMounted) return;

        // 3. Create fresh channel subscription
        channel = supabase
          .channel("portal-notifications-realtime")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "portal_notifications",
            },
            (payload: RealtimePostgresChangesPayload<{ [key: string]: unknown }>) => {
              if (!isMounted) return;

              if (payload.eventType === "INSERT") {
                const newNotif = (payload.new as unknown) as PortalNotification;
                if (!newNotif || !newNotif.id) return;

                // Deduplicate using ID
                if (knownIdsRef.current.has(newNotif.id)) {
                  return;
                }
                knownIdsRef.current.add(newNotif.id);

                // Prepend new notification
                setNotifications((prev) => [
                  newNotif,
                  ...prev.filter((n) => n.id !== newNotif.id),
                ]);

                if (!newNotif.is_read) {
                  setUnreadCount((c) => c + 1);
                }

                // Trigger sound & toast if initial mount is complete
                if (initialLoadedRef.current) {
                  if (!isMutedRef.current) {
                    playNotificationSound();
                  }
                  setToasts((prev) => [
                    newNotif,
                    ...prev.filter((t) => t.id !== newNotif.id).slice(0, 4),
                  ]);
                }
              } else if (payload.eventType === "UPDATE") {
                const updated = (payload.new as unknown) as PortalNotification;
                if (!updated || !updated.id) return;

                knownIdsRef.current.add(updated.id);

                if (updated.is_read) {
                  // Notification marked read (locally or on another portal/device)
                  // Remove immediately from displayed unread notifications
                  setNotifications((prev) => {
                    const existed = prev.some((n) => n.id === updated.id);
                    if (existed) {
                      setUnreadCount((c) => Math.max(0, c - 1));
                    }
                    return prev.filter((n) => n.id !== updated.id);
                  });
                  setToasts((prev) => prev.filter((t) => t.id !== updated.id));
                } else {
                  setNotifications((prev) =>
                    prev.map((item) =>
                      item.id === updated.id ? updated : item
                    )
                  );
                }
              } else if (payload.eventType === "DELETE") {
                const old = payload.old as { id?: string };
                if (!old || !old.id) return;
                knownIdsRef.current.delete(old.id);
                setNotifications((prev) => {
                  const item = prev.find((n) => n.id === old.id);
                  if (item && !item.is_read) {
                    setUnreadCount((c) => Math.max(0, c - 1));
                  }
                  return prev.filter((n) => n.id !== old.id);
                });
                setToasts((prev) => prev.filter((t) => t.id !== old.id));
              }
            }
          );

        if (channel) {
          channel.subscribe((status: string, err?: Error) => {
            if (err) {
              console.warn("[Realtime Notifications] Subscription warning:", err);
            }
          });
        }
      } catch (err) {
        console.warn("[Realtime Notifications] Setup exception:", err);
      }
    };

    setupRealtime();

    // 4. Listen to auth state changes to keep realtime authenticated across token refresh
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event: AuthChangeEvent, newSession: Session | null) => {
        if (!isMounted) return;
        if (newSession?.access_token) {
          try {
            await supabase.realtime.setAuth(newSession.access_token);
          } catch {
            // ignore setAuth refresh errors
          }
        }
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  // Dismiss toast
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Mark single notification as read
  const markAsRead = useCallback(async (id: string) => {
    // Optimistic UI update: immediately remove from displayed unread notifications
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    setToasts((prev) => prev.filter((t) => t.id !== id));

    try {
      await markNotificationAsReadAction(id);
    } catch (err) {
      console.error("[markAsRead] Server action failed:", err);
    }
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    // Optimistic UI update: immediately empty displayed unread list
    setNotifications([]);
    setUnreadCount(0);
    setToasts([]);

    try {
      await markAllNotificationsAsReadAction();
    } catch (err) {
      console.error("[markAllAsRead] Server action failed:", err);
    }
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isMuted,
        isOpen,
        toasts,
        setIsOpen,
        toggleOpen,
        toggleMute,
        markAsRead,
        markAllAsRead,
        dismissToast,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      "useNotifications must be used within a NotificationsProvider"
    );
  }
  return ctx;
}
