import { validateCartAction } from "@/lib/orders/actions";
import { describeUnavailableOnAdd } from "@/lib/menu/variant-availability";

/**
 * Asks the server whether a SIMPLE product + variant can still be ordered, right before it is
 * added to the cart (GitHub issue #77). A menu page can stay open for a long time; if the
 * bakery switched the item or variant off in the meantime, the customer is told immediately
 * instead of discovering it at checkout.
 *
 * Returns a customer-facing message when the item must NOT be added, otherwise null. If the
 * check itself cannot run (network, rate limit) it returns null and the item is added: the
 * live cart check at checkout (#75) and place_order still refuse anything unavailable.
 */
export async function checkItemBeforeAdd(item: {
  productId: string;
  variantId?: string;
  quantity: number;
  productName: string;
}): Promise<string | null> {
  if (!item.variantId) return null; // nothing the server can validate without a variant
  try {
    const result = await validateCartAction({
      items: [
        {
          productId: item.productId,
          kind: "SIMPLE",
          variantId: item.variantId,
          quantity: item.quantity,
        },
      ],
    });
    if (!result.success) return null;
    const check = result.items[0];
    if (check && check.status !== "OK") {
      return describeUnavailableOnAdd(check.status, check.productName || item.productName);
    }
    return null;
  } catch {
    return null;
  }
}
