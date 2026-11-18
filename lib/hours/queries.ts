import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BusinessHoursData, BusinessHoursEntry, SpecialClosure } from "./types";
import { buildSummaryLabel } from "./utils";

const LOCATION_SLUG = "namma-bakery-rr-nagar";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_placeholder";

/** The configured active location's id, or null when it cannot be resolved. */
async function getActiveLocationId(supabase: SupabaseClient): Promise<string | null> {
  const { data: location, error } = await supabase
    .from("locations")
    .select("id")
    .eq("slug", LOCATION_SLUG)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !location?.id) return null;
  return location.id;
}

export const getBusinessHoursData = cache(
  async (): Promise<BusinessHoursData | null> => {
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const locationId = await getActiveLocationId(supabase);
      if (!locationId) return null;

      const { data: rows, error: hoursErr } = await supabase
        .from("business_hours")
        .select("weekday, opens, closes")
        .eq("location_id", locationId)
        .order("weekday");

      if (hoursErr || !rows || rows.length === 0) return null;

      const entries: BusinessHoursEntry[] = rows.map(
        (r: { weekday: number; opens: string; closes: string }) => ({
          weekday: r.weekday,
          opens: r.opens.slice(0, 5),
          closes: r.closes.slice(0, 5),
        })
      );

      return {
        summaryLabel: buildSummaryLabel(entries),
        entries,
      };
    } catch {
      return null;
    }
  }
);

/**
 * Special closure dates (festivals, maintenance...) from `fromDate` (inclusive) to `toDate`
 * (inclusive, optional), as "YYYY-MM-DD" bakery-local dates. Public read: special_closures
 * is readable by anonymous visitors, like business_hours.
 *
 * Returns null when the closures could not be loaded, so callers can fail closed instead of
 * assuming the bakery is open.
 */
export const getSpecialClosures = cache(
  async (fromDate: string, toDate?: string): Promise<SpecialClosure[] | null> => {
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isDate(fromDate) || (toDate !== undefined && !isDate(toDate))) return null;

    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const locationId = await getActiveLocationId(supabase);
      if (!locationId) return null;

      let query = supabase
        .from("special_closures")
        .select("closure_date, reason")
        .eq("location_id", locationId)
        .gte("closure_date", fromDate)
        .order("closure_date");
      if (toDate !== undefined) query = query.lte("closure_date", toDate);

      const { data: rows, error } = await query;
      if (error || !rows) return null;

      return rows.map((r: { closure_date: string; reason: string | null }) => ({
        date: r.closure_date,
        reason: r.reason,
      }));
    } catch {
      return null;
    }
  }
);
