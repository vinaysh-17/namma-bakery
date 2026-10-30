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

  // Sync ref with state
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

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

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("portal-notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "portal_notifications",
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newNotif = payload.new as PortalNotification;
            if (!newNotif || !newNotif.id) return;

            // Deduplicate
            if (knownIdsRef.current.has(newNotif.id)) {
              return;
            }
            knownIdsRef.current.add(newNotif.id);

            // Prepend new notification
            setNotifications((prev) => [newNotif, ...prev]);

            if (!newNotif.is_read) {
              setUnreadCount((prev) => prev + 1);
            }

            // Only trigger sound & toast if initial load is already done
            if (initialLoadedRef.current) {
              if (!isMutedRef.current) {
                playNotificationSound();
              }
              // Add to bottom-right toasts
              setToasts((prev) => [newNotif, ...prev.slice(0, 4)]);
            }
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as PortalNotification;
            if (!updated || !updated.id) return;

            setNotifications((prev) =>
              prev.map((item) => (item.id === updated.id ? updated : item))
            );

            // Recalculate unread count
            setNotifications((curr) => {
              const unread = curr.filter((item) => !item.is_read).length;
              setUnreadCount(unread);
              return curr;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Dismiss toast
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Mark single notification as read
  const markAsRead = useCallback(async (id: string) => {
    // Optimistic UI update
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
      )
    );
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
    const now = new Date().toISOString();
    // Optimistic UI update
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: now }))
    );
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
