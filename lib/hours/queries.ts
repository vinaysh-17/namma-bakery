import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import type { BusinessHoursData, BusinessHoursEntry } from "./types";
import { formatTime24To12 } from "./utils";

const LOCATION_SLUG = "namma-bakery-rr-nagar";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_placeholder";

function buildSummaryLabel(entries: BusinessHoursEntry[]): string {
  if (entries.length === 0) return "Hours unavailable";

  const first = entries[0];
  const allSame = entries.every(
    (e) => e.opens === first.opens && e.closes === first.closes
  );

  if (allSame) {
    return `${formatTime24To12(first.opens)} – ${formatTime24To12(first.closes)}`;
  }

  return "Hours vary by day";
}

export const getBusinessHoursData = cache(
  async (): Promise<BusinessHoursData | null> => {
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const { data: location, error: locErr } = await supabase
        .from("locations")
        .select("id")
        .eq("slug", LOCATION_SLUG)
        .eq("is_active", true)
        .maybeSingle();

      if (locErr || !location?.id) return null;

      const { data: rows, error: hoursErr } = await supabase
        .from("business_hours")
        .select("weekday, opens, closes")
        .eq("location_id", location.id)
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

