import { createClient } from "@/lib/supabase/client";
import { formatPickupSlot, toValidDate } from "@/lib/utils/date";
import type {
  AvailablePickupSlotsResult,
  PickupScheduleWindow,
  PickupSlot,
  StoreStatus,
} from "./types";

export const DEFAULT_LOCATION_SLUG = "namma-bakery-rr-nagar";

/**
 * Valid slot duration intervals supported by Namma Bakery (store_settings constraint).
 */
const VALID_SLOT_MINUTES = [15, 30, 60] as const;

/**
 * Fetches current public store status (e.g. if orders are paused and configured slot_minutes).
 * Scoped to the target location (defaulting to DEFAULT_LOCATION_SLUG).
 * Fails closed without silent fallback if the database is unreachable or configuration is invalid.
 */
export async function getStoreStatus(
  supabaseClient?: ReturnType<typeof createClient>,
  locationSlug: string = DEFAULT_LOCATION_SLUG
): Promise<StoreStatus> {
  try {
    const supabase = supabaseClient ?? createClient();

    // 1. Resolve target location to prevent unconstrained multi-location lookup
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("id, slug, is_active")
      .eq("slug", locationSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (locationError || !location?.id) {
      return {
        isPaused: false,
        pauseMessage: null,
        slotMinutes: 0,
        error: "STORE_STATUS_UNAVAILABLE",
      };
    }

    // 2. Query public_store_status scoped strictly to this location
    const { data, error } = await supabase
      .from("public_store_status")
      .select("orders_paused_until, pause_message, slot_minutes")
      .eq("location_id", location.id)
      .maybeSingle();

    if (error || !data) {
      return {
        isPaused: false,
        pauseMessage: null,
        slotMinutes: 0,
        error: "STORE_STATUS_UNAVAILABLE",
      };
    }

    if (
      typeof data.slot_minutes !== "number" ||
      !VALID_SLOT_MINUTES.includes(data.slot_minutes as 15 | 30 | 60)
    ) {
      return {
        isPaused: false,
        pauseMessage: data.pause_message,
        slotMinutes: 0,
        error: "INVALID_SLOT_DURATION",
      };
    }

    const isPaused =
      Boolean(data.orders_paused_until) &&
      new Date(data.orders_paused_until).getTime() > Date.now();

    return {
      isPaused,
      pauseMessage: data.pause_message,
      slotMinutes: data.slot_minutes,
    };
  } catch {
    return {
      isPaused: false,
      pauseMessage: null,
      slotMinutes: 0,
      error: "STORE_STATUS_UNAVAILABLE",
    };
  }
}

/**
 * Fetches available pickup slots for a given date in Asia/Kolkata (IST).
 * Strictly queries the database (available_slots RPC, business_hours, special_closures)
 * using the location's configured store_settings.slot_minutes.
 *
 * Fails closed:
 * - Empty slots from available_slots RPC is a legitimate zero-availability result.
 * - If RPC or database fails, returns zero slots and distinguishable error (e.g. SLOT_FETCH_FAILED).
 * - Never fabricates or falls back to generated slots.
 */
export async function getAvailablePickupSlots(
  params: {
    dateString: string;
    minLeadMinutes?: number;
  },
  supabaseClient?: ReturnType<typeof createClient>
): Promise<AvailablePickupSlotsResult> {
  const { dateString, minLeadMinutes = 0 } = params;

  // Validate date format YYYY-MM-DD and prevent calendar rollover (e.g. 2026-02-31 rolling over into March)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return {
      slots: [],
      isClosed: false,
      error: "INVALID_DATE",
    };
  }

  const parsedUtcDate = new Date(`${dateString}T00:00:00Z`);
  if (
    Number.isNaN(parsedUtcDate.getTime()) ||
    parsedUtcDate.toISOString().slice(0, 10) !== dateString
  ) {
    return {
      slots: [],
      isClosed: false,
      error: "INVALID_DATE",
    };
  }

  try {
    const supabase = supabaseClient ?? createClient();

    // 1. Get primary active location
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("id, slug, is_active")
      .eq("slug", DEFAULT_LOCATION_SLUG)
      .eq("is_active", true)
      .maybeSingle();

    if (locationError || !location?.id) {
      return {
        slots: [],
        isClosed: false,
        error: "LOCATION_NOT_FOUND",
      };
    }

    // 2. Read configured slot_minutes from public_store_status (15, 30, or 60)
    const { data: storeStatus, error: statusError } = await supabase
      .from("public_store_status")
      .select("slot_minutes")
      .eq("location_id", location.id)
      .maybeSingle();

    if (statusError || !storeStatus) {
      return {
        slots: [],
        isClosed: false,
        error: "SLOT_FETCH_FAILED",
      };
    }

    const slotMinutes = storeStatus.slot_minutes;
    if (
      typeof slotMinutes !== "number" ||
      !VALID_SLOT_MINUTES.includes(slotMinutes as 15 | 30 | 60)
    ) {
      return {
        slots: [],
        isClosed: false,
        error: "INVALID_SLOT_DURATION",
      };
    }

    // 3. Check special calendar closures
    const { data: closure, error: closureError } = await supabase
      .from("special_closures")
      .select("closure_date, reason")
      .eq("location_id", location.id)
      .eq("closure_date", dateString)
      .maybeSingle();

    if (closureError) {
      return {
        slots: [],
        isClosed: false,
        error: "SLOT_FETCH_FAILED",
      };
    }

    if (closure) {
      return {
        slots: [],
        isClosed: true,
        closureReason: closure.reason || "Bakery closed on this date",
      };
    }

    // 4. Check weekly business hours for this weekday in Asia/Kolkata (IST)
    // Timezone-independent calculation matching PostgreSQL extract(dow from p_date)::int (0=Sun, 1=Mon, ..., 6=Sat)
    const weekday = parsedUtcDate.getUTCDay();
    const { data: hours, error: hoursError } = await supabase
      .from("business_hours")
      .select("opens, closes")
      .eq("location_id", location.id)
      .eq("weekday", weekday);

    if (hoursError) {
      return {
        slots: [],
        isClosed: false,
        error: "SLOT_FETCH_FAILED",
      };
    }

    if (!hours || hours.length === 0) {
      return {
        slots: [],
        isClosed: true,
        closureReason: "Bakery closed on this day",
      };
    }

    // 5. Query available_slots RPC
    const { data: rpcSlots, error: rpcError } = await supabase.rpc(
      "available_slots",
      {
        p_location: location.id,
        p_date: dateString,
        p_min_lead_minutes: minLeadMinutes,
      }
    );

    if (rpcError || !Array.isArray(rpcSlots)) {
      return {
        slots: [],
        isClosed: false,
        error: "SLOT_FETCH_FAILED",
      };
    }

    // Legitimate empty result from database (all slots passed / lead time / full)
    if (rpcSlots.length === 0) {
      return {
        slots: [],
        isClosed: false,
      };
    }

    // 6. Map database slot rows to PickupSlot using the configured slot_minutes
    const slots: PickupSlot[] = rpcSlots.map(
      (row: { slot_start: string; remaining: number }) => {
        const startDate = toValidDate(row.slot_start);
        const endDate = new Date(startDate.getTime() + slotMinutes * 60 * 1000);
        const isAvailable = row.remaining > 0;

        return {
          slotStart: startDate.toISOString(),
          slotEnd: endDate.toISOString(),
          formattedTime: formatPickupSlot(startDate, slotMinutes),
          remaining: row.remaining,
          isAvailable,
          disabledReason: !isAvailable ? "Slot is full" : undefined,
        };
      }
    );

    return {
      slots,
      isClosed: false,
    };
  } catch {
    return {
      slots: [],
      isClosed: false,
      error: "SLOT_FETCH_FAILED",
    };
  }
}

/**
 * Computes the IST weekday (0=Sunday..6=Saturday) for a "YYYY-MM-DD" calendar date
 * string, independent of the runtime's local timezone (matching PostgreSQL's
 * extract(dow from date)).
 */
function weekdayForDateString(dateString: string): number {
  return new Date(`${dateString}T00:00:00Z`).getUTCDay();
}

/**
 * Fetches weekly-closed weekdays and special calendar closures for the configured
 * location within [startDate, endDate] (inclusive, "YYYY-MM-DD"), for disabling
 * unavailable dates in the pickup date picker.
 *
 * Fails closed: on any database error, returns no known-open days so the caller never
 * presents an unknown date as available.
 */
export async function getPickupScheduleWindow(
  params: { startDate: string; endDate: string },
  supabaseClient?: ReturnType<typeof createClient>
): Promise<PickupScheduleWindow> {
  const { startDate, endDate } = params;

  try {
    const supabase = supabaseClient ?? createClient();

    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("id")
      .eq("slug", DEFAULT_LOCATION_SLUG)
      .eq("is_active", true)
      .maybeSingle();

    if (locationError || !location?.id) {
      return { closedWeekdays: [], specialClosures: {}, error: "LOCATION_NOT_FOUND" };
    }

    const [hoursResult, closuresResult] = await Promise.all([
      supabase.from("business_hours").select("weekday").eq("location_id", location.id),
      supabase
        .from("special_closures")
        .select("closure_date, reason")
        .eq("location_id", location.id)
        .gte("closure_date", startDate)
        .lte("closure_date", endDate),
    ]);

    if (hoursResult.error || closuresResult.error) {
      return { closedWeekdays: [], specialClosures: {}, error: "SCHEDULE_FETCH_FAILED" };
    }

    const openWeekdays = new Set((hoursResult.data ?? []).map((row: { weekday: number }) => row.weekday));
    const closedWeekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !openWeekdays.has(d));

    const specialClosures: Record<string, string> = {};
    for (const row of (closuresResult.data ?? []) as Array<{ closure_date: string; reason: string | null }>) {
      specialClosures[row.closure_date] = row.reason || "Bakery closed on this date";
    }

    return { closedWeekdays, specialClosures };
  } catch {
    return { closedWeekdays: [], specialClosures: {}, error: "SCHEDULE_FETCH_FAILED" };
  }
}

export { weekdayForDateString };
