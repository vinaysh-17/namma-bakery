"use server";

import { createAdminClient, isAdminClientAvailable } from "@/lib/supabase/admin";
import { notifyStaffChanged } from "@/lib/realtime/broadcast";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  placeOrderInputSchema,
  lookupOrderTokenSchema,
  validateCartInputSchema,
} from "./validation";
import type { PlaceOrderResult, ValidateCartResult, CartItemStatus } from "./types";
import { mapCartRpcError } from "./cart-errors";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limiter";
import { assertNotPreview } from "@/lib/security/preview-guard";

const DEFAULT_LOCATION_SLUG = "namma-bakery-rr-nagar";

// Rate limiting thresholds
const ORDER_IP_MAX_REQUESTS = 6;
const ORDER_IP_WINDOW_MS = 10 * 60 * 1000; // 6 orders per 10 minutes per IP

const ORDER_PHONE_MAX_REQUESTS = 3;
const ORDER_PHONE_WINDOW_MS = 10 * 60 * 1000; // 3 orders per 10 minutes per phone

const CART_CHECK_IP_MAX_REQUESTS = 30;
const CART_CHECK_IP_WINDOW_MS = 5 * 60 * 1000; // 30 cart checks per 5 minutes per IP

const LOOKUP_IP_MAX_REQUESTS = 10;
const LOOKUP_IP_WINDOW_MS = 5 * 60 * 1000; // 10 lookups per 5 minutes per IP

/**
 * Server Action: Places a customer order.
 *
 * HARDENED SECURITY & ARCHITECTURAL BOUNDARY:
 * 1. Rate Limiting: Sliding window per IP and per customer phone number.
 * 2. Strict Input Validation: Zod schema with `.strict()` rejects unknown fields, validates UUIDs, and enforces quantity bounds.
 * 3. Zero Trust Client Data: Server ignores all client prices and totals completely.
 * 4. Concurrency & Slot Locking: `place_order` locks store settings row in Postgres to prevent race conditions.
 * 5. Lead Time & Capacity: Authoritatively checked in Postgres against real menu items.
 * 6. PII & Error Sanitization: Database internal stack traces and SQL errors are never returned to client.
 */
export async function placeOrderAction(input: unknown): Promise<PlaceOrderResult> {
  // 1. IP-level rate limit check
  const clientIp = await getClientIp();
  const ipLimit = checkRateLimit({
    key: `order:ip:${clientIp}`,
    maxRequests: ORDER_IP_MAX_REQUESTS,
    windowMs: ORDER_IP_WINDOW_MS,
  });

  if (!ipLimit.allowed) {
    return {
      success: false,
      error: `Too many order attempts from your network. Please wait ${ipLimit.retryAfterSeconds} seconds before trying again.`,
      code: "RATE_LIMITED",
    };
  }

  // 2. Strict Zod Schema validation
  const parsed = placeOrderInputSchema.safeParse(input);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      success: false,
      error: firstIssue?.message || "Invalid order information provided.",
      code: "VALIDATION_FAILED",
    };
  }

  // 3. Phone-level rate limit check
  const cleanPhone = parsed.data.customerDetails.customerPhone;
  const phoneLimit = checkRateLimit({
    key: `order:phone:${cleanPhone}`,
    maxRequests: ORDER_PHONE_MAX_REQUESTS,
    windowMs: ORDER_PHONE_WINDOW_MS,
  });

  if (!phoneLimit.allowed) {
    return {
      success: false,
      error: `Too many order placement attempts for this phone number. Please wait ${phoneLimit.retryAfterSeconds} seconds before submitting again.`,
      code: "RATE_LIMITED",
    };
  }

  try {
    assertNotPreview();

    const supabase = createAdminClient();

    // 4. Resolve configured bakery location ID authoritatively using admin client
    const { data: locationData, error: locationError } = await supabase
      .from("locations")
      .select("id")
      .eq("slug", DEFAULT_LOCATION_SLUG)
      .eq("is_active", true)
      .maybeSingle();

    if (locationError) {
      console.error("[placeOrderAction] Database error querying location:", {
        slug: DEFAULT_LOCATION_SLUG,
        message: locationError.message,
        code: locationError.code,
      });
      return {
        success: false,
        error: "Bakery location could not be resolved. Please try again later.",
      };
    }

    if (!locationData?.id) {
      console.error("[placeOrderAction] Active bakery location not found:", {
        slug: DEFAULT_LOCATION_SLUG,
      });
      return {
        success: false,
        error: "Bakery location could not be resolved. Please try again later.",
      };
    }

    const locationId = locationData.id;

    // 5. Identify authenticated customer if present, otherwise null for guest
    let customerId: string | null = null;
    try {
      const serverAuthClient = await createServerClient();
      const {
        data: { user },
      } = await serverAuthClient.auth.getUser();
      if (user?.id) {
        customerId = user.id;
      }
    } catch {
      // Guest order
      customerId = null;
    }

    // 6. Format items matching database place_order(..., p_items jsonb) specification
    const p_items = parsed.data.items.map((it) => {
      if (it.kind === "TIERED_CAKE" && it.cakeConfig) {
        return {
          product_id: it.productId,
          quantity: it.quantity,
          weight_grams: it.cakeConfig.weightGrams,
          egg_type: it.cakeConfig.eggType,
          finish: it.cakeConfig.finish || "STANDARD",
          cake_message: it.cakeMessage ? it.cakeMessage.trim() : null,
          expected_unit_price_paise: it.expectedUnitPricePaise,
        };
      }
      return {
        product_id: it.productId,
        variant_id: it.variantId,
        quantity: it.quantity,
        // Compared with the live price by place_order; never used to price the order
        expected_unit_price_paise: it.expectedUnitPricePaise,
      };
    });

    // 7. Invoke Postgres place_order RPC with database-level concurrency & pricing authority
    const { data: rpcData, error: rpcError } = await supabase.rpc("place_order", {
      p_location_id: locationId,
      p_customer_id: customerId,
      p_name: parsed.data.customerDetails.customerName.trim(),
      p_phone: cleanPhone,
      p_email: parsed.data.customerDetails.customerEmail?.trim() || null,
      p_pickup: parsed.data.pickupSlotStart,
      p_notes: parsed.data.customerDetails.customerNotes?.trim() || null,
      p_items: p_items,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    });

    // 8. Handle and translate database business errors safely
    if (rpcError) {
      const msg = rpcError.message || "";
      // Log sanitized error code without customer PII
      console.error("[placeOrderAction] Order placement refused by database:", {
        code: rpcError.code,
        message: msg.slice(0, 100),
      });

      if (msg.includes("SLOT_FULL")) {
        return {
          success: false,
          error:
            "The selected pickup time slot is now full. Please choose another pickup slot.",
          code: "SLOT_FULL",
        };
      }
      if (msg.includes("ORDERS_PAUSED")) {
        return {
          success: false,
          error:
            "Order placement is currently paused by the bakery. Please check back shortly.",
          code: "ORDERS_PAUSED",
        };
      }
      if (msg.includes("TOO_MANY_OPEN_ORDERS")) {
        return {
          success: false,
          error:
            "You already have active open orders for this phone number. Please await fulfillment before placing another order.",
          code: "TOO_MANY_OPEN_ORDERS",
        };
      }
      if (msg.includes("CLOSED_DAY")) {
        return {
          success: false,
          error:
            "The bakery is closed on the selected date. Please pick another date.",
          code: "CLOSED_DAY",
        };
      }
      if (msg.includes("OUTSIDE_OPENING_HOURS")) {
        return {
          success: false,
          error:
            "The selected pickup time is outside store operating hours. Please pick another time slot.",
          code: "OUTSIDE_OPENING_HOURS",
        };
      }
      if (msg.includes("LEAD_TIME_NOT_MET")) {
        return {
          success: false,
          error:
            "Items in your cart require advance preparation time that is no longer satisfied by the selected slot. Please select a later pickup slot.",
          code: "LEAD_TIME_NOT_MET",
        };
      }
      // Price changed / product removed / option unavailable: name the item and make clear that
      // NO order was created (the database rolled the whole attempt back).
      const cartError = mapCartRpcError(msg);
      if (cartError) {
        return { success: false, error: cartError.error, code: cartError.code };
      }
      if (msg.includes("INVALID_QUANTITY")) {
        return {
          success: false,
          error: "Item quantity must be between 1 and 20.",
          code: "INVALID_QUANTITY",
        };
      }
      if (msg.includes("INVALID_NAME")) {
        return {
          success: false,
          error: "Customer name must be between 2 and 80 characters.",
          code: "INVALID_NAME",
        };
      }
      if (msg.includes("INVALID_PHONE")) {
        return {
          success: false,
          error: "Please enter a valid 10-digit Indian phone number.",
          code: "INVALID_PHONE",
        };
      }
      if (msg.includes("IDEMPOTENCY_KEY_REUSED") || msg.includes("INVALID_IDEMPOTENCY_KEY")) {
        // A stale or foreign checkout reference: the client starts a fresh attempt next time
        return {
          success: false,
          error:
            "We could not confirm this checkout attempt. Please review your order and place it again.",
          code: "IDEMPOTENCY_KEY_REJECTED",
        };
      }
      if (msg.includes("INVALID_ITEMS")) {
        return {
          success: false,
          error: "Invalid cart items provided. Please review your cart.",
          code: "INVALID_ITEMS",
        };
      }

      return {
        success: false,
        error:
          "We could not process your order at this time. Please check your details and try again.",
      };
    }

    // 9. Return generated order info
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row?.order_number || !row?.public_token) {
      return {
        success: false,
        error:
          "Order was received but tracking information was missing. Please contact the bakery.",
      };
    }

    // A replay returns the order that was already placed: staff were already notified
    const replayed = row.replayed === true;
    if (!replayed) {
      await notifyStaffChanged();
    }
    return {
      success: true,
      orderId: row.order_id,
      orderNumber: row.order_number,
      publicToken: row.public_token,
      replayed,
    };
  } catch (err) {
    // Avoid logging sensitive client PII
    console.error("[placeOrderAction] Unexpected server exception:", {
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return {
      success: false,
      error:
        "An unexpected error occurred while placing your order. Please try again.",
    };
  }
}

/**
 * Server Action: Checks the customer's cart against the LIVE menu without placing an order.
 *
 * Read-only. Returns, per cart item, whether it can still be ordered and its current
 * authoritative price (from the database function check_cart_items), so checkout can show
 * what changed before the customer submits. It is advisory: placeOrderAction / place_order
 * re-validate everything atomically when the order is actually placed.
 */
export async function validateCartAction(input: unknown): Promise<ValidateCartResult> {
  if (!isAdminClientAvailable()) {
    return { success: false, error: "Cart validation is not available in Preview mode." };
  }

  const clientIp = await getClientIp();
  const limit = checkRateLimit({
    key: `cartcheck:ip:${clientIp}`,
    maxRequests: CART_CHECK_IP_MAX_REQUESTS,
    windowMs: CART_CHECK_IP_WINDOW_MS,
  });
  if (!limit.allowed) {
    return { success: false, error: "Too many cart checks. Please wait a moment." };
  }

  const parsed = validateCartInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Your cart could not be checked." };
  }

  try {
    const supabase = createAdminClient();
    const p_items = parsed.data.items.map((it) =>
      it.kind === "TIERED_CAKE" && it.cakeConfig
        ? {
            product_id: it.productId,
            weight_grams: it.cakeConfig.weightGrams,
            egg_type: it.cakeConfig.eggType,
            finish: it.cakeConfig.finish || "STANDARD",
          }
        : { product_id: it.productId, variant_id: it.variantId }
    );

    const { data, error } = await supabase.rpc("check_cart_items", { p_items });
    if (error || !Array.isArray(data)) {
      console.error("[validateCartAction] Cart check failed:", {
        code: error?.code,
        message: (error?.message || "").slice(0, 100),
      });
      return { success: false, error: "Your cart could not be checked right now." };
    }

    const known: CartItemStatus[] = [
      "OK",
      "PRODUCT_NOT_FOUND",
      "PRODUCT_UNAVAILABLE",
      "OPTION_NOT_AVAILABLE",
    ];
    return {
      success: true,
      items: data.map((row) => ({
        index: Number(row.item_index),
        status: known.includes(row.item_status) ? row.item_status : "PRODUCT_UNAVAILABLE",
        productName: typeof row.item_name === "string" ? row.item_name : null,
        currentUnitPricePaise:
          typeof row.current_unit_price_paise === "number"
            ? row.current_unit_price_paise
            : null,
      })),
    };
  } catch (err) {
    console.error("[validateCartAction] Unexpected error:", {
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return { success: false, error: "Your cart could not be checked right now." };
  }
}

/**
 * Server Action: Looks up an order's secure public_token using order number + customer phone number.
 *
 * HARDENED ABUSE PROTECTION:
 * - Rate limited by IP (max 10 attempts per 5 minutes) to prevent brute force scraping or enumeration.
 * - Strict regex input validation for order number and Indian mobile format.
 * - Database RPC only returns the public_token if BOTH order number and phone number match.
 */
export async function lookupOrderTokenAction(
  input: unknown
): Promise<{ success: boolean; token?: string; error?: string }> {
  if (!isAdminClientAvailable()) {
    return { success: false, error: "Order lookup is not available in Preview mode." };
  }

  // 1. IP Rate Limiting
  const clientIp = await getClientIp();
  const ipLimit = checkRateLimit({
    key: `lookup:ip:${clientIp}`,
    maxRequests: LOOKUP_IP_MAX_REQUESTS,
    windowMs: LOOKUP_IP_WINDOW_MS,
  });

  if (!ipLimit.allowed) {
    return {
      success: false,
      error: `Too many tracking lookup requests. Please wait ${ipLimit.retryAfterSeconds} seconds before searching again.`,
    };
  }

  // 2. Strict Input Validation
  const parsed = lookupOrderTokenSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ||
        "Please provide a valid order number (e.g. NB1001) and 10-digit phone number.",
    };
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("find_order_token", {
      p_order_number: parsed.data.orderNumber.trim(),
      p_phone: parsed.data.phone.trim(),
    });

    if (error || !data) {
      return {
        success: false,
        error:
          "No matching order found. Please verify your order number (e.g. NB1001) and 10-digit phone number.",
      };
    }

    return {
      success: true,
      token: data as string,
    };
  } catch (err) {
    console.error("[lookupOrderTokenAction] Unexpected error:", {
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return {
      success: false,
      error: "Unable to search orders at this time. Please try again later.",
    };
  }
}
