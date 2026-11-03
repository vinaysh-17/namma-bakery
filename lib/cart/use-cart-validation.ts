"use client";

import * as React from "react";
import type { CartItem } from "./types";
import { validateCartAction } from "@/lib/orders/actions";
import { deriveCartIssues, type CartIssue } from "./cart-issues";

export type { CartIssue };

/** idle = no result yet (initial / being checked), done = checked, unavailable = could not check */
export type CartValidationState = "idle" | "done" | "unavailable";

type CheckOutcome = { state: CartValidationState; issues: CartIssue[] };

async function checkCartAgainstMenu(current: CartItem[]): Promise<CheckOutcome> {
  try {
    const result = await validateCartAction({
      items: current.map((item) => ({
        productId: item.productId,
        kind: item.kind,
        variantId: item.variantId,
        quantity: item.quantity,
        cakeConfig: item.configuration
          ? {
              weightGrams: item.configuration.weightGrams,
              eggType: item.configuration.eggType,
              finish: item.configuration.finish,
            }
          : undefined,
      })),
    });
    if (!result.success) return { state: "unavailable", issues: [] };

    const issues = deriveCartIssues(current, result.items);
    return { state: "done", issues };
  } catch {
    return { state: "unavailable", issues: [] };
  }
}

/**
 * Checks the cart against the live menu (GitHub issue #75). The result is advisory and drives
 * the "review your cart" notice; the order itself is re-validated atomically by place_order.
 * If the check cannot run (network, rate limit) the state is "unavailable" and checkout is
 * NOT blocked: the server still refuses a stale order with a specific message.
 */
export function useCartValidation(items: CartItem[], enabled: boolean) {
  const [outcome, setOutcome] = React.useState<CheckOutcome>({ state: "idle", issues: [] });
  const latest = React.useRef(0);
  const itemsRef = React.useRef(items);
  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Re-run only when the set of lines or their saved prices change, not on every quantity tap
  const signature = React.useMemo(
    () => items.map((i) => `${i.itemKey}@${i.unitPricePaise}`).join("|"),
    [items]
  );

  const run = React.useCallback(() => {
    const current = itemsRef.current;
    if (current.length === 0) return;
    const id = ++latest.current;
    void checkCartAgainstMenu(current).then((next) => {
      if (id === latest.current) setOutcome(next); // ignore results of superseded checks
    });
  }, []);

  React.useEffect(() => {
    if (enabled) run();
  }, [enabled, signature, run]);

  // An empty cart has nothing to report
  const issues = items.length === 0 ? [] : outcome.issues;
  return { state: outcome.state, issues, recheck: run };
}
