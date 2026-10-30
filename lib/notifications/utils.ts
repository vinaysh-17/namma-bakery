/**
 * Formats a timestamp into a concise relative time string.
 * Examples: "Just now", "2m ago", "1h ago", "Yesterday", "3d ago".
 */
export function formatRelativeTime(
  dateInput: string | Date | number,
  nowMs?: number
): string {
  try {
    const date = typeof dateInput === "object" ? dateInput : new Date(dateInput);

    // During server prerender, avoid reading Date.now() / new Date() to keep static shell stable
    if (typeof window === "undefined" && !nowMs) {
      return date.toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric",
      });
    }

    const currentMs = nowMs ?? Date.now();
    const diffMs = currentMs - date.getTime();

    // Future or very recent (< 45 seconds)
    if (diffMs < 45 * 1000) {
      return "Just now";
    }

    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays === 1) {
      return "Yesterday";
    }
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }

    // Default to short date
    return date.toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

