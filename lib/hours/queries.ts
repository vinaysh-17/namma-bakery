import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BusinessHoursData, BusinessHoursEntry } from "./types";
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
