"use client";

import React, { useRef } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "./notifications-context";
import { NotificationCenter } from "./notification-center";

export function NotificationBell({ className = "" }: { className?: string } = {}) {
  const { unreadCount, isOpen, toggleOpen } = useNotifications();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const formattedCount = unreadCount > 9 ? "9+" : unreadCount > 0 ? `${unreadCount}` : null;

  return (
    <div className={`relative inline-flex items-center ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
            : "Notifications"
        }
        className={`relative flex h-9 w-9 items-center justify-center rounded-sm border transition-colors cursor-pointer shrink-0 ${
          isOpen
            ? "border-caramel bg-muted text-foreground ring-1 ring-caramel"
            : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Bell className="size-4 shrink-0 transition-transform active:scale-95" />

        {/* Unread Count Badge */}
        {formattedCount && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-caramel px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-background animate-in zoom-in duration-150">
            {formattedCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      <NotificationCenter triggerRef={triggerRef} />
    </div>
  );
}

