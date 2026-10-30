"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, Sparkles, X } from "lucide-react";
import { useNotifications } from "./notifications-context";
import { formatRelativeTime } from "@/lib/notifications/utils";
import type { PortalNotification } from "@/lib/notifications/types";

function ToastItem({
  notification,
  onDismiss,
  onClick,
}: {
  notification: PortalNotification;
  onDismiss: (id: string) => void;
  onClick: (notif: PortalNotification) => void;
}) {
  // Auto-dismiss after 6 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(notification.id);
    }, 6000);

    return () => clearTimeout(timer);
  }, [notification.id, onDismiss]);

  const isOrder = notification.type === "NEW_ORDER";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-sm border border-border bg-card p-3.5 shadow-xl text-card-foreground animate-in slide-in-from-bottom-5 fade-in duration-200 transition-all hover:border-caramel/60"
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

      {/* Clickable notification content */}
      <div
        onClick={() => onClick(notification)}
        className="flex-1 min-w-0 cursor-pointer space-y-0.5"
      >
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs font-semibold text-foreground truncate">
            {notification.title}
          </p>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatRelativeTime(notification.created_at)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">
          {notification.message}
        </p>
      </div>

      {/* Dismiss Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification.id);
        }}
        title="Dismiss notification"
        aria-label="Dismiss notification"
        className="size-6 -mr-1 -mt-1 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function NotificationToastContainer() {
  const { toasts, dismissToast, markAsRead } = useNotifications();
  const router = useRouter();

  if (toasts.length === 0) return null;

  const handleToastClick = async (notif: PortalNotification) => {
    await markAsRead(notif.id);
    dismissToast(notif.id);
    if (notif.link_url) {
      router.push(notif.link_url);
    }
  };

  return (
    <div
      aria-label="Live notifications"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          notification={toast}
          onDismiss={dismissToast}
          onClick={handleToastClick}
        />
      ))}
    </div>
  );
}

