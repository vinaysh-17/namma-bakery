/**
 * Customer-facing messages for the cart/menu errors raised by place_order (GitHub issue #75).
 *
 * Kept out of the "use server" actions file so it can be unit-tested directly. The database
 * raises e.g. `PRICE_CHANGED: Black Forest`; the product name after the colon is the only part
 * taken from the message, and it is cleaned and length-limited. Raw database text is never
 * returned to the customer.
 */

export type CartErrorCode =
  | "PRICE_CHANGED"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_UNAVAILABLE"
  | "OPTION_NOT_AVAILABLE";

const CART_ERROR_CODES: CartErrorCode[] = [
  "PRICE_CHANGED",
  "PRODUCT_NOT_FOUND",
  "PRODUCT_UNAVAILABLE",
  "OPTION_NOT_AVAILABLE",
];

/** Extracts a safe product name from "CODE: Product name" (empty string when absent). */
export function extractProductName(message: string, code: string): string {
  const idx = message.indexOf(`${code}:`);
  if (idx === -1) return "";
  const raw = message.slice(idx + code.length + 1).split(/[\r\n]/)[0] ?? "";
  // Keep letters and combining marks (any script, e.g. Kannada), digits, spaces and common name punctuation only
  const cleaned = raw
    .replace(/[^\p{L}\p{M}\p{N} .,&'()+\-/]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80);
}

export function mapCartRpcError(
  message: string
): { error: string; code: CartErrorCode } | null {
  const code = CART_ERROR_CODES.find((c) => message.includes(c));
  if (!code) return null;
  const name = extractProductName(message, code);
  const subject = name ? `"${name}"` : "An item in your cart";
  const forItem = name ? `"${name}"` : "an item in your cart";

  switch (code) {
    case "PRICE_CHANGED":
      return {
        code,
        error: `The price of ${forItem} has changed since you added it. Your order was not placed. Please review the updated prices and place your order again.`,
      };
    case "PRODUCT_NOT_FOUND":
      return {
        code,
        error: `${subject} is no longer available. Your order was not placed. Please remove it from your cart and try again.`,
      };
    case "PRODUCT_UNAVAILABLE":
      return {
        code,
        error: `${subject} is currently unavailable. Your order was not placed. Please remove it from your cart and try again.`,
      };
    case "OPTION_NOT_AVAILABLE":
      return {
        code,
        error: `The selected size or option for ${forItem} is no longer available. Your order was not placed. Please update your cart and try again.`,
      };
  }
}
