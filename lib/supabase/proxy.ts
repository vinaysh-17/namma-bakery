import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Synchronizes Supabase auth session tokens via cookies during request processing in Next.js Proxy.
 *
 * Requirements (#99):
 * 1. Automatically refreshes expired sessions before Server Components render.
 * 2. Synchronizes refreshed cookies onto both the downstream request headers and the outgoing response.
 * 3. Prevents session loss during SSR and eliminates repeated Phone OTP requests in "Find My Orders".
 * 4. Performs zero database table/role queries to preserve Proxy performance.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_placeholder";

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Calling getUser refreshes the session token if expired and triggers setAll
  await supabase.auth.getUser();

  return supabaseResponse;
}
