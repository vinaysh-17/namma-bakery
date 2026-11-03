/**
 * Pure rules for deciding whether a customer's already-chosen pickup slot is still valid for
 * their current cart (GitHub issue #76). No server or browser imports, so it is unit-testable.
 *
 * The database stays the authority: place_order re-checks the pickup time, lead time, opening
 * hours and slot capacity when the order is created. These rules only let the storefront notice
 * a stale slot BEFORE the customer submits.
 *
 * Lead time in the database is the MAXIMUM products.lead_time_minutes among the products in the
 * cart. It does not depend on quantity or on the chosen variant, so only adding or removing a
 * product can change it.
 */

export type SlotInvalidReason =
  | "LEAD_TIME_NOT_MET" // the cart now needs more preparation time than this slot allows
  | "SLOT_FULL" // the slot has filled up since it was chosen
  | "SLOT_UNAVAILABLE"; // closed day / outside opening hours / already passed

export type SlotValidity =
  | { valid: true; requiredLeadMinutes: number }
  | { valid: false; reason: SlotInvalidReason; requiredLeadMinutes: number };

/** A row of the available_slots RPC */
export interface SlotRow {
  slot_start: string;
  remaining: number;
}

/** Required lead time = the longest lead time among the cart's (live) products. */
export function getRequiredLeadMinutes(leadTimes: number[]): number {
  return Math.max(0, ...leadTimes.filter((n) => Number.isFinite(n)));
}

/**
 * The part of a cart that can change lead time: which products it contains. Quantity and
 * variant changes leave this signature (and therefore the slot validity) unchanged.
 */
export function getLeadSignature<T extends { productId: string }>(items: T[]): string {
  return Array.from(new Set(items.map((i) => i.productId))).sort().join("|");
}

function findSlot(rows: SlotRow[], slotStart: string): SlotRow | undefined {
  const target = new Date(slotStart).getTime();
  if (Number.isNaN(target)) return undefined;
  return rows.find((row) => new Date(row.slot_start).getTime() === target);
}

/**
 * @param slotsForCart  available_slots for the slot's date WITH the cart's required lead time
 * @param slotsAnyLead  available_slots for the same date with NO lead time (to tell a lead-time
 *                      problem apart from a closed / passed slot)
 */
export function evaluateSelectedSlot(params: {
  slotStart: string;
  requiredLeadMinutes: number;
  slotsForCart: SlotRow[];
  slotsAnyLead: SlotRow[];
}): SlotValidity {
  const { slotStart, requiredLeadMinutes, slotsForCart, slotsAnyLead } = params;

  const offered = findSlot(slotsForCart, slotStart);
  if (offered) {
    return offered.remaining > 0
      ? { valid: true, requiredLeadMinutes }
      : { valid: false, reason: "SLOT_FULL", requiredLeadMinutes };
  }

  // Not offered for this cart. If it exists once the lead time is ignored, the lead time is
  // what rules it out; otherwise the slot is closed / outside hours / already in the past.
  const withoutLead = findSlot(slotsAnyLead, slotStart);
  if (withoutLead && requiredLeadMinutes > 0) {
    return { valid: false, reason: "LEAD_TIME_NOT_MET", requiredLeadMinutes };
  }
  return { valid: false, reason: "SLOT_UNAVAILABLE", requiredLeadMinutes };
}

/** Customer-facing explanation. `pickupSummary` is e.g. "Sat, 25 Oct, 12:00 PM – 12:30 PM". */
export function describeInvalidSlot(
  reason: SlotInvalidReason,
  pickupSummary: string,
  requiredLeadMinutes: number
): string {
  switch (reason) {
    case "LEAD_TIME_NOT_MET": {
      const hours = Math.round((requiredLeadMinutes / 60) * 10) / 10;
      const prep =
        requiredLeadMinutes >= 60
          ? `about ${hours} ${hours === 1 ? "hour" : "hours"} of preparation`
          : `${requiredLeadMinutes} minutes of preparation`;
      return `Your pickup time (${pickupSummary}) is no longer available for the items in your cart, which need ${prep}. Please choose a later time.`;
    }
    case "SLOT_FULL":
      return `Your pickup time (${pickupSummary}) has just filled up. Please choose another time.`;
    default:
      return `Your pickup time (${pickupSummary}) is no longer available. Please choose another time.`;
  }
}
