import type { CartItem } from "./types";
import type { CartItemCheck } from "@/lib/orders/types";

/** A cart line that no longer matches the live menu (GitHub issue #75). */
export type CartIssue =
  | {
      kind: "UNAVAILABLE";
      itemKey: string;
      productName: string;
      /** PRODUCT = the whole product, OPTION = the chosen size / variant / finish */
      reason: "PRODUCT" | "OPTION";
    }
  | {
      kind: "PRICE_CHANGED";
      itemKey: string;
      productName: string;
      oldUnitPricePaise: number;
      newUnitPricePaise: number;
    };

/**
 * Compares cart lines with the live menu result of check_cart_items. `checks[n].index` is the
 * position of the cart line that was sent. The live (database) price is the only price that
 * counts; the cart's saved price is just what the customer was shown.
 */
export function deriveCartIssues(items: CartItem[], checks: CartItemCheck[]): CartIssue[] {
  const issues: CartIssue[] = [];
  for (const check of checks) {
    const item = items[check.index];
    if (!item) continue;
    const name = check.productName || item.productName;
    if (check.status !== "OK") {
      issues.push({
        kind: "UNAVAILABLE",
        itemKey: item.itemKey,
        productName: name,
        reason: check.status === "OPTION_NOT_AVAILABLE" ? "OPTION" : "PRODUCT",
      });
    } else if (
      check.currentUnitPricePaise !== null &&
      check.currentUnitPricePaise !== item.unitPricePaise
    ) {
      issues.push({
        kind: "PRICE_CHANGED",
        itemKey: item.itemKey,
        productName: name,
        oldUnitPricePaise: item.unitPricePaise,
        newUnitPricePaise: check.currentUnitPricePaise,
      });
    }
  }
  return issues;
}
