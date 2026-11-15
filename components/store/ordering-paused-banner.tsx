"use client";

import { AlertCircle } from "lucide-react";
import type { OrderingPausedStatus } from "@/lib/pickup/use-store-status";

/**
 * Shared "online ordering is paused" notice (GitHub issue #74). Renders nothing until
 * the status has actually been checked, and nothing at all when ordering isn't paused.
 */
export function OrderingPausedBanner({
  status,
  className = "",
}: {
  status: OrderingPausedStatus;
  className?: string;
}) {
  if (!status.checked || !status.isPaused) return null;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-sm border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200 ${className}`}
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400 mt-0.5" aria-hidden="true" />
      <div>
        <p className="font-semibold text-sm">Online Ordering Temporarily Paused</p>
        <p className="mt-1 leading-relaxed">
          {status.pauseMessage ||
            "The bakery has paused new online orders for now. Please check back shortly."}
        </p>
      </div>
    </div>
  );
}
