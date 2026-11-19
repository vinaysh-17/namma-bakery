"use server";

import { z } from "zod";
import { createAdminClient, isAdminClientAvailable } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limiter";
import { getIstDateString } from "@/lib/utils/date";
import {
  evaluateSelectedSlot,
  getRequiredLeadMinutes,
  type SlotInvalidReason,
  type SlotRow,
} from "./slot-validity";

const DEFAULT_LOCATION_SLUG = "namma-bakery-rr-nagar";
const SLOT_CHECK_IP_MAX_REQUESTS = 30;
const SLOT_CHECK_IP_WINDOW_MS = 5 * 60 * 1000;

const validatePickupSlotSchema = z
  .object({
    productIds: z.array(z.string().uuid()).min(1).max(20),
    slotStart: z
      .string()
      .min(1)
      .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid pickup time"),
  })
  .strict();

export type ValidatePickupSlotResult =
  | { success: true; valid: true; requiredLeadMinutes: number }
  | {
      success: true;
      valid: false;
      reason: SlotInvalidReason;
      requiredLeadMinutes: number;
    }
  | { success: false; error: string };

/**
 * Server Action: is the customer's chosen pickup slot still valid for their current cart?
 * (GitHub issue #76.)
 *
 * Read-only and advisory: place_order re-validates the pickup time, lead time, opening hours
 * and capacity atomically when the order is created. Nothing the client sends is trusted for
 * the decision:
 *   - lead time is read from the live products table (not from the cart),
 *   - the slot's availability comes from the database's available_slots function, which
 *     applies the configured opening hours, closures, slot length and capacity.
 */
export async function validatePickupSlotAction(
  input: unknown
): Promise<ValidatePickupSlotResult> {
  if (!isAdminClientAvailable()) {
    return { success: false, error: "Pickup slot validation is not available in Preview mode." };
  }

  const clientIp = await getClientIp();
  const limit = checkRateLimit({
    key: `slotcheck:ip:${clientIp}`,
    maxRequests: SLOT_CHECK_IP_MAX_REQUESTS,
    windowMs: SLOT_CHECK_IP_WINDOW_MS,
  });
  if (!limit.allowed) {
    return { success: false, error: "Too many pickup checks. Please wait a moment." };
  }

  const parsed = validatePickupSlotSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Your pickup time could not be checked." };
  }

  try {
    const supabase = createAdminClient();

    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("id")
      .eq("slug", DEFAULT_LOCATION_SLUG)
      .eq("is_active", true)
      .maybeSingle();
    if (locationError || !location?.id) {
      return { success: false, error: "Your pickup time could not be checked right now." };
    }

    // Live lead time: the longest lead time among the products still on the menu. Products that
    // were removed are reported by the live cart check (#75), not here.
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, lead_time_minutes")
      .in("id", parsed.data.productIds)
      .is("archived_at", null);
    if (productsError || !Array.isArray(products)) {
      return { success: false, error: "Your pickup time could not be checked right now." };
    }
    const requiredLeadMinutes = getRequiredLeadMinutes(
      products.map((p) => Number(p.lead_time_minutes))
    );

    const slotDate = getIstDateString(parsed.data.slotStart);
    const fetchSlots = async (lead: number): Promise<SlotRow[] | null> => {
      const { data, error } = await supabase.rpc("available_slots", {
        p_location: location.id,
        p_date: slotDate,
        p_min_lead_minutes: lead,
      });
      if (error || !Array.isArray(data)) return null;
      return data as SlotRow[];
    };

    const slotsForCart = await fetchSlots(requiredLeadMinutes);
    // Only needed to tell "lead time" apart from "closed / passed" when the slot is missing
    const slotsAnyLead =
      requiredLeadMinutes > 0 ? await fetchSlots(0) : slotsForCart;
    if (!slotsForCart || !slotsAnyLead) {
      return { success: false, error: "Your pickup time could not be checked right now." };
    }

    const verdict = evaluateSelectedSlot({
      slotStart: parsed.data.slotStart,
      requiredLeadMinutes,
      slotsForCart,
      slotsAnyLead,
    });

    return verdict.valid
      ? { success: true, valid: true, requiredLeadMinutes }
      : {
          success: true,
          valid: false,
          reason: verdict.reason,
          requiredLeadMinutes,
        };
  } catch (err) {
    console.error("[validatePickupSlotAction] Unexpected error:", {
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return { success: false, error: "Your pickup time could not be checked right now." };
  }
}
