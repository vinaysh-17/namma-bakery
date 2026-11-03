/**
 * Idempotency keys for order placement (GitHub issue #98).
 *
 * One key identifies ONE checkout attempt. It is sent with every submit of that attempt, so if
 * the order is committed but the response is lost and the customer retries, the database
 * returns the already-created order instead of creating a second one.
 *
 * The key is an unguessable random value (it is the only thing that lets a retry find its
 * order), generated in the browser. Format: letters, digits, "-" and "_", 16-100 characters -
 * the same pattern the database enforces.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older browsers: 128 random bits as hex
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
