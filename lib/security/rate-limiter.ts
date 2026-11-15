import { headers } from "next/headers";

interface RateLimitRecord {
  timestamps: number[];
}

export interface RateLimitOptions {
  key: string;
  maxRequests: number;
  windowMs: number;
  record?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

// In-memory sliding window bucket store
const rateLimitStore = new Map<string, RateLimitRecord>();

// Periodic cleanup of stale entries to prevent memory accumulation
const CLEANUP_INTERVAL_MS = 60 * 1000;
let lastCleanup = Date.now();

function purgeStaleRecords(now: number, maxRetentionMs: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, record] of rateLimitStore.entries()) {
    const freshTimestamps = record.timestamps.filter(
      (ts) => now - ts < maxRetentionMs
    );
    if (freshTimestamps.length === 0) {
      rateLimitStore.delete(key);
    } else {
      record.timestamps = freshTimestamps;
    }
  }
}

/**
 * Checks and optionally updates rate limit state for a given key using a sliding window algorithm.
 *
 * Characteristics:
 * - In-memory, zero-dependency, zero external cost.
 * - Supports non-incrementing peek checks (record: false) for two-stage auth validation.
 * - Prunes stale memory automatically.
 */
export function checkRateLimit(options: RateLimitOptions): RateLimitResult {
  const { key, maxRequests, windowMs, record = true } = options;
  const now = Date.now();

  purgeStaleRecords(now, windowMs * 2);

  let bucket = rateLimitStore.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    rateLimitStore.set(key, bucket);
  }

  // Filter timestamps within current window
  const windowStart = now - windowMs;
  bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);

  if (bucket.timestamps.length >= maxRequests) {
    const oldest = bucket.timestamps[0];
    const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  if (record) {
    bucket.timestamps.push(now);
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - bucket.timestamps.length),
    retryAfterSeconds: 0,
  };
}

/**
 * Inspects whether a rate limit threshold has been exceeded without recording an attempt.
 */
export function peekRateLimit(options: Omit<RateLimitOptions, "record">): RateLimitResult {
  return checkRateLimit({ ...options, record: false });
}

/**
 * Records an attempt for a rate limit bucket.
 */
export function recordRateLimitHit(key: string): void {
  let bucket = rateLimitStore.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    rateLimitStore.set(key, bucket);
  }
  bucket.timestamps.push(Date.now());
}

/**
 * Resets rate limit attempts for a given key (e.g. upon successful authentication).
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

/**
 * Extracts client IP safely from Next.js request headers.
 */
export async function getClientIp(): Promise<string> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }
    const realIp = headerList.get("x-real-ip");
    if (realIp) {
      return realIp.trim();
    }
    return "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}
