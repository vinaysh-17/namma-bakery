import * as React from "react";
import { AlertCircle } from "lucide-react";
import type { CartIssue } from "@/lib/cart/use-cart-validation";
import { formatPaise } from "@/lib/utils/money";

interface CartChangesNoticeProps {
  issues: CartIssue[];
  onAcceptPrices: () => void;
  onRemoveUnavailable: () => void;
}

/**
 * Tells the customer exactly which cart items changed on the live menu (GitHub issue #75).
 * Prices are never changed silently: the customer reviews them and confirms with
 * "Update prices", and unavailable items must be removed before the order can be placed.
 */
export function CartChangesNotice({
  issues,
  onAcceptPrices,
  onRemoveUnavailable,
}: CartChangesNoticeProps) {
  if (issues.length === 0) return null;

  const priceIssues = issues.filter((i) => i.kind === "PRICE_CHANGED");
  const unavailable = issues.filter((i) => i.kind === "UNAVAILABLE");

  return (
    <div
      role="alert"
      aria-live="polite"
      className="mb-6 rounded-sm border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 sm:p-4 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 sm:h-5 sm:w-5 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm font-semibold">Your cart needs a quick review</p>
          <p className="leading-relaxed">
            The bakery menu changed since you added these items. Please review before you place
            your order.
          </p>

          {unavailable.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-semibold">No longer available</p>
              <ul className="list-disc space-y-1 pl-5">
                {unavailable.map((issue) => (
                  <li key={issue.itemKey} className="break-words">
                    <span className="font-medium">{issue.productName}</span>
                    {issue.kind === "UNAVAILABLE" && issue.reason === "OPTION"
                      ? " - the size or option you chose is no longer available"
                      : " - this item is no longer available"}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={onRemoveUnavailable}
                className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center rounded-sm border border-amber-700/50 bg-white px-4 text-xs font-semibold text-amber-950 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel sm:w-auto dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-950/40"
              >
                Remove unavailable {unavailable.length === 1 ? "item" : "items"}
              </button>
            </div>
          )}

          {priceIssues.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-semibold">Price changed</p>
              <ul className="list-disc space-y-1 pl-5">
                {priceIssues.map(
                  (issue) =>
                    issue.kind === "PRICE_CHANGED" && (
                      <li key={issue.itemKey} className="break-words">
                        <span className="font-medium">{issue.productName}</span>:{" "}
                        <span className="line-through">
                          {formatPaise(issue.oldUnitPricePaise)}
                        </span>{" "}
                        now{" "}
                        <span className="font-semibold">
                          {formatPaise(issue.newUnitPricePaise)}
                        </span>{" "}
                        each
                      </li>
                    )
                )}
              </ul>
              <button
                type="button"
                onClick={onAcceptPrices}
                className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center rounded-sm bg-caramel px-4 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-caramel/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel sm:w-auto"
              >
                Update prices
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
