/**
 * Masks a user's email address for privacy in portal headers and display interfaces.
 *
 * Rules:
 * - Shows first 3 characters of the email's local part.
 * - Shows last 2 characters of the email's local part.
 * - Replaces everything between them with asterisks (*).
 * - Preserves the entire email domain unchanged.
 *
 * Example:
 *   shvinaysiddhu@gmail.com -> shv********hu@gmail.com
 */
export function maskUserEmail(email?: string | null): string {
  if (!email || typeof email !== "string") {
    return "";
  }

  const trimmed = email.trim();
  const atIndex = trimmed.indexOf("@");

  if (atIndex === -1) {
    if (trimmed.length <= 5) return trimmed;
    const first3 = trimmed.slice(0, 3);
    const last2 = trimmed.slice(-2);
    const maskedMiddle = "*".repeat(trimmed.length - 5);
    return `${first3}${maskedMiddle}${last2}`;
  }

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);

  // If local part has more than 5 characters:
  // Show first 3, last 2, and mask everything in between
  if (local.length > 5) {
    const first3 = local.slice(0, 3);
    const last2 = local.slice(-2);
    const maskedMiddle = "*".repeat(local.length - 5);
    return `${first3}${maskedMiddle}${last2}${domain}`;
  }

  // Graceful fallback for short local parts (<= 2 chars)
  if (local.length <= 2) {
    return `${local.slice(0, 1)}***${domain}`;
  }

  // For 3, 4, or 5 character local parts: keep first 1 and last 1, mask between
  const first1 = local.slice(0, 1);
  const last1 = local.slice(-1);
  const maskedMiddle = "*".repeat(local.length - 2);
  return `${first1}${maskedMiddle}${last1}${domain}`;
}

