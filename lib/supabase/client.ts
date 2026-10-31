import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;

/**
 * Browser Supabase Client.
 *
 * For use in Client Components ("use client").
 * Uses public URL and modern publishable API key (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
 * Implements browser singleton to prevent duplicate WebSocket connections and Realtime channel churn.
 * Safe to import and execute in browser runtime.
 */
export function createClient() {
  if (client) return client;

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_placeholder";

  client = createBrowserClient(supabaseUrl, supabasePublishableKey);
  return client;
}
