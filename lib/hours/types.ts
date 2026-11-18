export interface BusinessHoursEntry {
  weekday: number;
  opens: string;
  closes: string;
}

export interface BusinessHoursData {
  summaryLabel: string;
  entries: BusinessHoursEntry[];
}

/** A date the bakery is closed regardless of its weekly hours (special_closures row). */
export interface SpecialClosure {
  /** Calendar date, "YYYY-MM-DD" (bakery local date). */
  date: string;
  reason: string | null;
}

/** A customer-facing pickup window with its 24-hour bounds ("HH:MM"). */
export interface PickupWindow {
  /** Display text, e.g. "10:00 AM – 12:00 PM". This is also the value the custom cake form submits. */
  label: string;
  start: string;
  end: string;
}
