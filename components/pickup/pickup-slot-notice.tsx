import * as React from "react";
import { AlertCircle } from "lucide-react";

/**
 * Explains why the customer's chosen pickup time was cleared (GitHub issue #76), for example
 * because items they added need more preparation time. The customer chooses a new time; the
 * app never picks one for them.
 */
export function PickupSlotNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-sm border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
    >
      <AlertCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold">Please choose a new pickup time</p>
        <p className="leading-relaxed break-words">{message}</p>
      </div>
    </div>
  );
}
