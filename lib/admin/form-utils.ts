/**
 * Parses a numeric admin-form field, distinguishing a genuinely blank/invalid input
 * (falls back) from a deliberately entered 0 (passed through unchanged). GitHub issue
 * #67: the previous `parseInt(x, 10) || fallback` pattern treated 0 as falsy and silently
 * replaced it with the fallback, even though 0 is a valid, meaningful value for several
 * store settings (e.g. "no cancellation cutoff", "accept no custom cakes today").
 *
 * The server's own Zod validation (lib/admin/validation.ts) remains the authority on
 * which values are actually acceptable (e.g. pending_alert_minutes must be positive) --
 * this only controls what gets sent, not what gets accepted.
 */
export function parseSettingsInt(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
