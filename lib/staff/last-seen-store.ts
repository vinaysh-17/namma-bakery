// Client-side "last seen custom cake" timestamp, exposed as an external store so it can
// be read with useSyncExternalStore (server snapshot = null, so no hydration mismatch, #104).

const listeners = new Set<() => void>();
const memory = new Map<string, number>();

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
function readStored(key: string): number | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const parsed = Number.parseInt(storage.getItem(key) ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Newest of the persisted value and this tab's in-memory value (covers blocked storage). */
export function readLastSeen(key: string): number | null {
  const stored = readStored(key);
  const mem = memory.get(key) ?? null;
  if (stored === null) return mem;
  if (mem === null) return stored;
  return Math.max(stored, mem);
}

export function writeLastSeen(key: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) return;
  const next = Math.max(value, readLastSeen(key) ?? 0);
  memory.set(key, next);
  try {
    getStorage()?.setItem(key, String(next));
  } catch {
    // Storage unavailable: the in-memory value still clears the badge this session.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeLastSeen(callback: () => void): () => void {
  listeners.add(callback);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", callback);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", callback);
    }
  };
}
