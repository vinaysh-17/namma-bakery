"use client";

import React, { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  ShoppingBag,
  Sparkles,
  CheckCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useNotifications } from "./notifications-context";
import { formatRelativeTime } from "@/lib/notifications/utils";
import type { PortalNotification } from "@/lib/notifications/types";

interface NotificationCenterProps {
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function NotificationCenter({ triggerRef }: NotificationCenterProps = {}) {
  const {
    notifications,
    unreadCount,
    isMuted,
    isOpen,
    setIsOpen,
    toggleMute,
    markAsRead,
    markAllAsRead,
  } = useNotifications();

  const router = useRouter();
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;

      // Ignore clicks on trigger button to allow toggleOpen to handle toggling cleanly
      if (triggerRef?.current && triggerRef.current.contains(target)) {
        return;
      }

      if (
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, setIsOpen, triggerRef]);

  if (!isOpen) return null;

  const handleNotificationClick = async (notif: PortalNotification) => {
    if (!notif.is_read) {
      await markAsRead(notif.id);
    }
    setIsOpen(false);
    if (notif.link_url) {
      router.push(notif.link_url);
    }
  };

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Notification Center"
      className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-sm rounded-sm border border-border bg-card text-card-foreground shadow-xl z-50 animate-in fade-in-50 zoom-in-95 duration-150 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/40">
        <div className="flex items-center gap-2">
          <span className="font-heading text-sm font-bold text-foreground tracking-tight">
            Notifications
          </span>
          {unreadCount > 0 && (
            <span className="rounded-full bg-caramel/15 text-caramel text-[11px] font-semibold px-2 py-0.5">
              {unreadCount} new
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Mute/Unmute Toggle */}
          <button
            type="button"
            onClick={toggleMute}
            title={isMuted ? "Unmute notification sounds" : "Mute notification sounds"}
            aria-label={isMuted ? "Unmute notification sounds" : "Mute notification sounds"}
            className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            {isMuted ? (
              <VolumeX className="size-3.5 text-muted-foreground" />
            ) : (
              <Volume2 className="size-3.5 text-foreground" />
            )}
          </button>

          {/* Mark all as read */}
          <button
            type="button"
            onClick={() => markAllAsRead()}
            disabled={unreadCount === 0}
            title="Mark all as read"
            aria-label="Mark all notifications as read"
            className="flex items-center gap-1 px-2 h-7 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <CheckCheck className="size-3.5" />
            <span className="text-[11px] hidden sm:inline">Mark all read</span>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="max-h-84 overflow-y-auto divide-y divide-border/60">
        {notifications.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-2">
            <div className="size-10 rounded-full bg-muted/80 flex items-center justify-center mx-auto text-muted-foreground">
              <Bell className="size-5 opacity-60" />
            </div>
            <p className="text-xs font-medium text-foreground">
              No notifications yet
            </p>
            <p className="text-[11px] text-muted-foreground max-w-[220px] mx-auto">
              New orders and custom cake enquiries will appear here in real-time.
            </p>
          </div>
        ) : (
          notifications.map((notif) => {
            const isUnread = !notif.is_read;
            const isOrder = notif.type === "NEW_ORDER";

            return (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleNotificationClick(notif)}
                className={`w-full text-left p-3 flex items-start gap-3 transition-colors hover:bg-muted/60 cursor-pointer ${
                  isUnread ? "bg-caramel/[0.04]" : "bg-card opacity-85"
                }`}
              >
                {/* Type Icon */}
                <div
                  className={`size-8 rounded-sm shrink-0 flex items-center justify-center mt-0.5 ${
                    isOrder
                      ? "bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800"
                      : "bg-rose-100 text-rose-900 border border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800"
                  }`}
                >
                  {isOrder ? (
                    <ShoppingBag className="size-4 text-caramel dark:text-amber-300" />
                  ) : (
                    <Sparkles className="size-4 text-rose-600 dark:text-rose-400" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center justify-between gap-1">
                    <p
                      className={`text-xs truncate ${
                        isUnread
                          ? "font-semibold text-foreground"
                          : "font-medium text-foreground/80"
                      }`}
                    >
                      {notif.title}
                    </p>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatRelativeTime(notif.created_at)}
                    </span>
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                    {notif.message}
                  </p>
                </div>

                {/* Unread dot */}
                {isUnread && (
                  <span
                    className="size-2 rounded-full bg-caramel mt-1.5 shrink-0"
                    title="Unread"
                  />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

