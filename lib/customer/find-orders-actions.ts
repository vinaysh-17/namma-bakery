"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { indianPhoneSchema } from "@/lib/validation/common";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limiter";
import {
  createTrackingSessionToken,
  setTrackingSessionCookie,
  clearTrackingSessionCookie,
  maskPhoneNumber,
} from "@/lib/custom-cake/tracking-session";
import type {
  MyOrdersResult,
  MyOrderSummary,
  MyCustomRequestSummary,
} from "./find-orders-types";

/**
 * "Find My Orders": guest customers recover their orders by proving ownership of their
 * phone number with Supabase Phone OTP (the standard Supabase Auth flow; in development the
 * test phone numbers + fixed test OTPs configured in the Supabase dashboard are used, so no
 * SMS provider or cost is involved).
 *
 * Security:
 * - The phone number used for the lookup ALWAYS comes from the verified Supabase session
 *   (auth.users.phone), never from the request. Changing anything client side cannot reveal
 *   another customer's orders.
 * - Order data is read through a service-role-only SECURITY DEFINER database function
 *   (list_orders_for_phone); the service-role key never leaves the server.
 * - Responses never reveal whether a phone number has orders before it is verified.
 */

const IP_WINDOW_MS = 10 * 60 * 1000;
const SEND_IP_MAX = 10;
const SEND_PHONE_MAX = 5;
const VERIFY_IP_MAX = 20;
const VERIFY_PHONE_MAX = 8;

type ActionResult = { success: boolean; error?: string; maskedPhone?: string };

function normalizePhoneInput(
  raw: unknown
): { national: string; e164: string } | null {
  const parsed = indianPhoneSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { national: parsed.data, e164: `+91${parsed.data}` };
}

/** Step 1: send a one-time code to the phone (Supabase Phone OTP). */
export async function sendFindOrdersOtpAction(input: {
  phone: string;
}): Promise<ActionResult> {
  const phone = normalizePhoneInput(input?.phone);
  if (!phone) {
    return {
      success: false,
      error: "Please enter a valid phone number.",
    };
  }

  const ip = await getClientIp();
  const ipLimit = checkRateLimit({
    key: `findorders:send:ip:${ip}`,
    maxRequests: SEND_IP_MAX,
    windowMs: IP_WINDOW_MS,
  });
  const phoneLimit = checkRateLimit({
    key: `findorders:send:phone:${phone.national}`,
    maxRequests: SEND_PHONE_MAX,
    windowMs: IP_WINDOW_MS,
  });
  if (!ipLimit.allowed || !phoneLimit.allowed) {
    return {
      success: false,
      error: "Too many code requests. Please wait a few minutes and try again.",
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone: phone.e164,
      options: { shouldCreateUser: true, channel: "sms" },
    });

    if (error) {
      console.error("[findOrders] OTP send failed:", error.status, error.code);
      if (error.status === 429 || error.code === "over_sms_send_rate_limit") {
        return {
          success: false,
          error: "Too many code requests. Please wait a few minutes and try again.",
        };
      }
      return {
        success: false,
        error: "We couldn't send a verification code right now. Please try again shortly.",
      };
    }

    return { success: true, maskedPhone: maskPhoneNumber(phone.national) };
  } catch (err) {
    console.error("[findOrders] OTP send exception:", err instanceof Error ? err.message : err);
    return {
      success: false,
      error: "A network error occurred. Please check your connection and try again.",
    };
  }
}

/** Step 2: verify the code. On success a normal Supabase Auth session is established. */
export async function verifyFindOrdersOtpAction(input: {
  phone: string;
  code: string;
}): Promise<ActionResult> {
  const phone = normalizePhoneInput(input?.phone);
  const code = typeof input?.code === "string" ? input.code.trim() : "";
  if (!phone || !/^\d{4,8}$/.test(code)) {
    return { success: false, error: "Enter the verification code we sent you." };
  }

  const ip = await getClientIp();
  const ipLimit = checkRateLimit({
    key: `findorders:verify:ip:${ip}`,
    maxRequests: VERIFY_IP_MAX,
    windowMs: IP_WINDOW_MS,
  });
  const phoneLimit = checkRateLimit({
    key: `findorders:verify:phone:${phone.national}`,
    maxRequests: VERIFY_PHONE_MAX,
    windowMs: IP_WINDOW_MS,
  });
  if (!ipLimit.allowed || !phoneLimit.allowed) {
    return {
      success: false,
      error: "Too many attempts. Please wait a few minutes and try again.",
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      phone: phone.e164,
      token: code,
      type: "sms",
    });

    if (error || !data.user) {
      if (error?.status === 429) {
        return {
          success: false,
          error: "Too many attempts. Please wait a few minutes and try again.",
        };
      }
      return {
        success: false,
        error: "That code is incorrect or has expired. Please try again or request a new code.",
      };
    }

    // The existing custom cake tracker accepts a signed, HTTP-only session for a phone.
    // Phone ownership is now proven by OTP, so reuse it so "Custom Cakes" open in the
    // existing tracker without asking for the enquiry number again.
    const verifiedPhone = (data.user.phone ?? phone.e164).replace(/\D/g, "").slice(-10);
    await setTrackingSessionCookie(
      createTrackingSessionToken({
        phone: verifiedPhone,
        verifiedRequestNumber: "OTP",
      })
    );

    return { success: true, maskedPhone: maskPhoneNumber(verifiedPhone) };
  } catch (err) {
    console.error("[findOrders] OTP verify exception:", err instanceof Error ? err.message : err);
    return {
      success: false,
      error: "A network error occurred. Please check your connection and try again.",
    };
  }
}

/**
 * Lists the orders / custom cake requests of the phone number verified in the current
 * Supabase session. Takes NO parameters on purpose: the phone comes from the session.
 */
export async function getMyOrdersAction(): Promise<MyOrdersResult> {
  try {
    const supabase = await createClient();
    // getUser() re-validates the session with Supabase Auth (not just the cookie)
    const { data, error } = await supabase.auth.getUser();
    const verifiedPhone = data.user?.phone;

    if (error || !data.user || !verifiedPhone || !data.user.phone_confirmed_at) {
      return { authenticated: false };
    }

    const national = verifiedPhone.replace(/\D/g, "").slice(-10);
    if (national.length < 10) {
      return { authenticated: false };
    }

    const admin = createAdminClient();
    const { data: rows, error: rpcError } = await admin.rpc("list_orders_for_phone", {
      p_phone: national,
    });

    if (rpcError) {
      console.error("[findOrders] list_orders_for_phone failed:", rpcError.code);
      return {
        authenticated: true,
        maskedPhone: maskPhoneNumber(national),
        error:
          "We couldn't load your orders right now. Please try again in a moment.",
      };
    }

    const result = (rows ?? {}) as {
      orders?: MyOrderSummary[];
      custom_requests?: MyCustomRequestSummary[];
    };

    return {
      authenticated: true,
      maskedPhone: maskPhoneNumber(national),
      orders: result.orders ?? [],
      customRequests: result.custom_requests ?? [],
    };
  } catch (err) {
    console.error("[findOrders] getMyOrders exception:", err instanceof Error ? err.message : err);
    return { authenticated: false, error: "Something went wrong. Please try again." };
  }
}

/** Ends the customer's phone session and the related custom cake tracker session. */
export async function signOutFindOrdersAction(): Promise<{ success: boolean }> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
    await clearTrackingSessionCookie();
    return { success: true };
  } catch {
    return { success: false };
  }
}
