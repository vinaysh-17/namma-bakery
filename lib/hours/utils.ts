import type { BusinessHoursEntry, PickupWindow, SpecialClosure } from "./types";

export function formatTime24To12(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}:00 ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

const DAYS_IN_WEEK = 7;

/**
 * One-line summary of the configured opening hours, shown in the header, footer, hero,
 * checkout and similar places.
 *
 * A closed weekday has no business_hours row (see archiveBusinessHourAction), so rows alone
 * cannot say whether every day is covered. Fewer than seven distinct weekdays therefore means
 * at least one day is closed, and a single "10:00 AM - 9:30 PM" range would wrongly read as
 * "open every day".
 */
export function buildSummaryLabel(entries: BusinessHoursEntry[]): string {
  if (entries.length === 0) return "Hours unavailable";

  const distinctWeekdays = new Set(entries.map((e) => e.weekday));
  if (distinctWeekdays.size < DAYS_IN_WEEK) return "Hours vary by day";

  const first = entries[0];
  const allSame = entries.every(
    (e) => e.opens === first.opens && e.closes === first.closes
  );

  if (allSame) {
    return `${formatTime24To12(first.opens)} – ${formatTime24To12(first.closes)}`;
  }

  return "Hours vary by day";
}

const WINDOW_MINUTES = 120;
const MIN_WINDOW_MINUTES = 30;
const IST_OFFSET = "+05:30";
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad2 = (n: number) => n.toString().padStart(2, "0");
const toHHMM = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

/**
 * Pickup windows (two hours each; a closing fragment of at least 30 minutes is kept) for the
 * given weekday, with their 24-hour bounds. A weekday without a business_hours row is closed
 * and yields no windows.
 */
export function generatePickupWindowDetails(
  entries: BusinessHoursEntry[],
  weekday: number
): PickupWindow[] {
  const entry = entries.find((e) => e.weekday === weekday);
  if (!entry) return [];

  const [openH, openM] = entry.opens.split(":").map(Number);
  const [closeH, closeM] = entry.closes.split(":").map(Number);
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;

  if (closeMins <= openMins) return [];

  const windows: PickupWindow[] = [];
  let start = openMins;

  while (start < closeMins) {
    let end = start + WINDOW_MINUTES;
    if (end > closeMins) end = closeMins;
    if (end - start < MIN_WINDOW_MINUTES) break;

    windows.push({
      label: `${formatTime24To12(toHHMM(start))} – ${formatTime24To12(toHHMM(end))}`,
      start: toHHMM(start),
      end: toHHMM(end),
    });
    start = end;
  }

  return windows;
}

export function generatePickupWindows(
  entries: BusinessHoursEntry[],
  weekday: number
): string[] {
  return generatePickupWindowDetails(entries, weekday).map((w) => w.label);
}

/** True for a "YYYY-MM-DD" string that is a real calendar date ("2026-02-30" is not). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Weekday (0 = Sunday .. 6 = Saturday) of a calendar date, matching Postgres extract(dow ...). */
export function getWeekdayForDate(dateString: string): number {
  return new Date(`${dateString}T00:00:00Z`).getUTCDay();
}

function formatCalendarDate(dateString: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${dateString}T00:00:00Z`));
}

/** Why a pickup date can or cannot be used. */
export type PickupAvailability =
  | { status: "OPEN"; windows: PickupWindow[] }
  | { status: "INVALID_DATE" }
  | { status: "NO_HOURS" }
  | { status: "SPECIAL_CLOSURE"; reason: string | null }
  | { status: "CLOSED_WEEKDAY"; weekday: number }
  | { status: "NO_WINDOWS" };

/**
 * What the bakery offers on one calendar date, in the same order the database applies it
 * (place_order, migration 0025): a special closure wins, then a weekday with no business_hours
 * row is closed, then the weekday's hours decide the windows.
 *
 * `closures` of null/undefined means "none known"; callers that must not guess (the server)
 * check for that themselves (see validateRequestedPickup).
 */
export function getPickupAvailability(
  entries: BusinessHoursEntry[] | null | undefined,
  closures: SpecialClosure[] | null | undefined,
  dateString: string
): PickupAvailability {
  if (!isCalendarDate(dateString)) return { status: "INVALID_DATE" };
  if (!entries || entries.length === 0) return { status: "NO_HOURS" };

  const closure = closures?.find((c) => c.date === dateString);
  if (closure) return { status: "SPECIAL_CLOSURE", reason: closure.reason };

  const weekday = getWeekdayForDate(dateString);
  if (!entries.some((e) => e.weekday === weekday)) {
    return { status: "CLOSED_WEEKDAY", weekday };
  }

  const windows = generatePickupWindowDetails(entries, weekday);
  if (windows.length === 0) return { status: "NO_WINDOWS" };

  return { status: "OPEN", windows };
}

/** Customer-facing explanation for a date that has no pickup windows. */
export function describePickupUnavailability(
  availability: Exclude<PickupAvailability, { status: "OPEN" }>,
  dateString: string
): string {
  switch (availability.status) {
    case "INVALID_DATE":
      return "Please choose a valid pickup date.";
    case "NO_HOURS":
      return "Pickup hours aren't available right now. Please try again later.";
    case "SPECIAL_CLOSURE": {
      const reason = availability.reason?.trim();
      return `The bakery is closed on ${formatCalendarDate(dateString)}${
        reason ? ` (${reason})` : ""
      }. Please choose another pickup date.`;
    }
    case "CLOSED_WEEKDAY":
      return `The bakery is closed on ${WEEKDAY_NAMES[availability.weekday]}s. Please choose another pickup date.`;
    case "NO_WINDOWS":
      return "No pickup windows are available on this date. Please choose another pickup date.";
  }
}

export type RequestedPickupField = "preferredPickupDate" | "preferredPickupTime";

export type RequestedPickupResult =
  | {
      ok: true;
      window: PickupWindow;
      /** Start of the chosen window as an IST timestamp, e.g. "2026-12-02T10:00:00+05:30". */
      pickupIso: string;
    }
  | {
      ok: false;
      code:
        | Exclude<PickupAvailability["status"], "OPEN">
        | "CLOSURES_UNKNOWN"
        | "INVALID_TIME";
      /** The form field the message belongs to; undefined when it is not about a field. */
      field?: RequestedPickupField;
      message: string;
    };

/**
 * Server-side check of a requested custom cake pickup: the date must be open (hours and special
 * closures) and the time must be exactly one of the windows offered for that date.
 *
 * Fails closed: closures that could not be loaded (null) reject the request instead of assuming
 * the bakery is open. There is no default time: a time that is not one of the offered windows
 * is rejected, never replaced.
 */
export function validateRequestedPickup(input: {
  entries: BusinessHoursEntry[] | null | undefined;
  closures: SpecialClosure[] | null | undefined;
  dateString: string;
  timeLabel: string;
}): RequestedPickupResult {
  const { entries, closures, dateString, timeLabel } = input;

  const unavailable = (
    availability: Exclude<PickupAvailability, { status: "OPEN" }>
  ): RequestedPickupResult => ({
    ok: false,
    code: availability.status,
    field:
      availability.status === "NO_HOURS" ? undefined : "preferredPickupDate",
    message: describePickupUnavailability(availability, dateString),
  });

  if (!isCalendarDate(dateString)) return unavailable({ status: "INVALID_DATE" });
  if (!entries || entries.length === 0) return unavailable({ status: "NO_HOURS" });

  if (!closures) {
    return {
      ok: false,
      code: "CLOSURES_UNKNOWN",
      message: "We couldn't check our pickup availability right now. Please try again in a moment.",
    };
  }

  const availability = getPickupAvailability(entries, closures, dateString);
  if (availability.status !== "OPEN") return unavailable(availability);

  const window =
    typeof timeLabel === "string"
      ? availability.windows.find((w) => w.label === timeLabel)
      : undefined;
  if (!window) {
    return {
      ok: false,
      code: "INVALID_TIME",
      field: "preferredPickupTime",
      message:
        "That pickup window isn't available on the selected date. Please choose one of the listed windows.",
    };
  }

  return { ok: true, window, pickupIso: `${dateString}T${window.start}:00${IST_OFFSET}` };
}