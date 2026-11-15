import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 Proxy (formerly middleware) for Namma Bakery.
 *
 * Runs before request completion to synchronize Supabase auth sessions
 * and ensure refreshed session cookies are forwarded to Server Components
 * and the browser client (#99).
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export default proxy;

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static build assets)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static image/asset extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
