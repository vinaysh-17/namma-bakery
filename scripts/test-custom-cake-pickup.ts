/**
 * Offline tests for custom cake pickup validation (no database, no network).
 *
 * Covers the shared rules in lib/hours/utils.ts that both the custom cake form and the
 * submit server action use:
 *   - which windows are offered on a date (weekly hours),
 *   - closed weekdays and special closures,
 *   - rejecting a time that is not one of the offered windows (no silent default),
 *   - failing closed when closure data is missing,
 * plus source-level checks that the action validates before it writes anything.
 *
 * Run: npx tsx scripts/test-custom-cake-pickup.ts
 */

import fs from "node:fs";
import path from "node:path";
import {
  describePickupUnavailability,
  generatePickupWindowDetails,
  generatePickupWindows,
  getPickupAvailability,
  getWeekdayForDate,
  isCalendarDate,
  validateRequestedPickup,
} from "../lib/hours/utils";
import type { BusinessHoursEntry, SpecialClosure } from "../lib/hours/types";

let failures = 0;
function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${testName}`);
  } else {
    failures++;
    console.error(`  FAIL  ${testName}${detail ? `\n        ${detail}` : ""}`);
  }
}

/** First calendar date on or after 2027-03-01 that falls on the given weekday (0 = Sunday). */
function dateOnWeekday(weekday: number): string {
  for (let day = 1; day <= 7; day++) {
    const candidate = `2027-03-${String(day).padStart(2, "0")}`;
    if (getWeekdayForDate(candidate) === weekday) return candidate;
  }
  throw new Error("unreachable");
}

const hours = (weekday: number, opens: string, closes: string): BusinessHoursEntry => ({
  weekday,
  opens,
  closes,
});

// Mon-Fri 10:00-21:30, Saturday 10:00-15:00, Sunday closed (no row).
const ENTRIES: BusinessHoursEntry[] = [
  hours(1, "10:00", "21:30"),
  hours(2, "10:00", "21:30"),
  hours(3, "10:00", "21:30"),
  hours(4, "10:00", "21:30"),
  hours(5, "10:00", "21:30"),
  hours(6, "10:00", "15:00"),
];

const MONDAY = dateOnWeekday(1);
const WEDNESDAY = dateOnWeekday(3);
const SATURDAY = dateOnWeekday(6);
const SUNDAY = dateOnWeekday(0);
const CLOSURES: SpecialClosure[] = [{ date: WEDNESDAY, reason: "Festival holiday" }];

const validate = (dateString: string, timeLabel: string, closures: SpecialClosure[] | null = CLOSURES) =>
  validateRequestedPickup({ entries: ENTRIES, closures, dateString, timeLabel });

// ---------------------------------------------------------------------------
console.log("\n--- Pickup windows follow the weekday's hours ---");
{
  const monday = generatePickupWindows(ENTRIES, 1);
  assert(
    monday.length === 6 && monday[0] === "10:00 AM – 12:00 PM" && monday.at(-1) === "8:00 PM – 9:30 PM",
    "Mon 10:00-21:30 gives six windows, the last a 90-minute closing window",
    JSON.stringify(monday)
  );
  const saturday = generatePickupWindows(ENTRIES, 6);
  assert(
    JSON.stringify(saturday) ===
      JSON.stringify(["10:00 AM – 12:00 PM", "12:00 PM – 2:00 PM", "2:00 PM – 3:00 PM"]),
    "Sat 10:00-15:00 gives three windows ending 3:00 PM",
    JSON.stringify(saturday)
  );
  assert(generatePickupWindows(ENTRIES, 0).length === 0, "A weekday with no business_hours row has no windows");
  assert(
    generatePickupWindows([hours(1, "10:00", "12:20")], 1).length === 1,
    "A closing fragment under 30 minutes is dropped"
  );
  assert(
    generatePickupWindows([hours(1, "10:00", "12:30")], 1).length === 2,
    "A closing fragment of 30 minutes is kept"
  );
  assert(generatePickupWindows([hours(1, "12:00", "10:00")], 1).length === 0, "Closing before opening gives no windows");
  assert(
    JSON.stringify(generatePickupWindowDetails(ENTRIES, 1).map((w) => w.label)) === JSON.stringify(monday),
    "Window details and window labels are the same list"
  );
  assert(
    generatePickupWindowDetails(ENTRIES, 1)[0].start === "10:00" &&
      generatePickupWindowDetails(ENTRIES, 1)[0].end === "12:00" &&
      generatePickupWindowDetails(ENTRIES, 1).at(-1)!.start === "20:00",
    "Window details carry 24-hour start and end"
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- What the bakery offers on a date ---");
{
  const open = getPickupAvailability(ENTRIES, CLOSURES, MONDAY);
  assert(open.status === "OPEN" && open.windows.length === 6, "Open weekday is OPEN with its windows");
  assert(getPickupAvailability(ENTRIES, CLOSURES, SUNDAY).status === "CLOSED_WEEKDAY", "Weekday without hours is CLOSED_WEEKDAY");
  const closure = getPickupAvailability(ENTRIES, CLOSURES, WEDNESDAY);
  assert(
    closure.status === "SPECIAL_CLOSURE" && closure.reason === "Festival holiday",
    "A special closure date is SPECIAL_CLOSURE even though the weekday normally has hours"
  );
  assert(
    getPickupAvailability(ENTRIES, [{ date: SUNDAY, reason: null }], SUNDAY).status === "SPECIAL_CLOSURE",
    "A special closure on an already-closed weekday reports the closure first (same order as place_order)"
  );
  assert(getPickupAvailability(null, CLOSURES, MONDAY).status === "NO_HOURS", "No hours data is NO_HOURS");
  assert(getPickupAvailability([], CLOSURES, MONDAY).status === "NO_HOURS", "Empty hours list is NO_HOURS");
  assert(
    getPickupAvailability([hours(1, "12:00", "10:00")], [], MONDAY).status === "NO_WINDOWS",
    "A weekday whose hours produce no windows is NO_WINDOWS"
  );
  assert(getPickupAvailability(ENTRIES, CLOSURES, "").status === "INVALID_DATE", "Empty date is INVALID_DATE");
  assert(getPickupAvailability(ENTRIES, CLOSURES, "2027-02-30").status === "INVALID_DATE", "Impossible date is INVALID_DATE");
  assert(
    getPickupAvailability(ENTRIES, null, MONDAY).status === "OPEN",
    "The form's view treats unknown closures as none (the server does not, see below)"
  );
  assert(
    isCalendarDate("2028-02-29") && !isCalendarDate("2027-02-29") && !isCalendarDate("2027-3-1") && !isCalendarDate(null),
    "isCalendarDate: leap day only in a leap year, strict format, rejects non-strings"
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- Server-side validation of the requested pickup ---");
{
  const ok = validate(MONDAY, "10:00 AM – 12:00 PM");
  assert(
    ok.ok && ok.pickupIso === `${MONDAY}T10:00:00+05:30` && ok.window.label === "10:00 AM – 12:00 PM",
    "A listed window on an open day is accepted and becomes its IST start time",
    JSON.stringify(ok)
  );
  const last = validate(MONDAY, "8:00 PM – 9:30 PM");
  assert(last.ok && last.pickupIso === `${MONDAY}T20:00:00+05:30`, "The closing window is accepted (starts 20:00)");
  const afternoon = validate(SATURDAY, "2:00 PM – 3:00 PM");
  assert(afternoon.ok && afternoon.pickupIso === `${SATURDAY}T14:00:00+05:30`, "Saturday's shorter closing window is accepted");

  const sunday = validate(SUNDAY, "10:00 AM – 12:00 PM");
  assert(
    !sunday.ok && sunday.code === "CLOSED_WEEKDAY" && sunday.field === "preferredPickupDate" && /closed on Sundays/.test(sunday.message),
    "A closed weekday is rejected at the date field",
    JSON.stringify(sunday)
  );
  const festival = validate(WEDNESDAY, "10:00 AM – 12:00 PM");
  assert(
    !festival.ok &&
      festival.code === "SPECIAL_CLOSURE" &&
      festival.field === "preferredPickupDate" &&
      /Festival holiday/.test(festival.message),
    "A special closure is rejected at the date field, with its reason",
    JSON.stringify(festival)
  );
  const noReason = validate(WEDNESDAY, "10:00 AM – 12:00 PM", [{ date: WEDNESDAY, reason: null }]);
  assert(!noReason.ok && !/\(/.test(noReason.message), "A closure without a reason has no empty brackets in its message");

  // Time must be one of the windows offered for THAT date.
  for (const [label, time] of [
    ["a window from another weekday (Mon's 8:00 PM on a Saturday)", "8:00 PM – 9:30 PM"],
    ["out-of-hours time", "3:00 AM – 5:00 AM"],
    ["a hyphen instead of the en dash", "10:00 AM - 12:00 PM"],
    ["a 24-hour time", "16:00"],
    ["free text", "asap"],
    ["extra whitespace", " 10:00 AM – 12:00 PM"],
    ["the empty string", ""],
  ] as const) {
    const result = validate(SATURDAY, time);
    assert(
      !result.ok && result.code === "INVALID_TIME" && result.field === "preferredPickupTime",
      `Rejected at the time field: ${label}`,
      JSON.stringify(result)
    );
  }
  const notAString = validateRequestedPickup({
    entries: ENTRIES,
    closures: CLOSURES,
    dateString: MONDAY,
    timeLabel: undefined as unknown as string,
  });
  assert(!notAString.ok && notAString.code === "INVALID_TIME", "A missing time value is rejected, not defaulted");

  // Fail closed.
  const unknownClosures = validate(MONDAY, "10:00 AM – 12:00 PM", null);
  assert(
    !unknownClosures.ok && unknownClosures.code === "CLOSURES_UNKNOWN" && unknownClosures.field === undefined,
    "Closures that could not be loaded reject the request (fail closed), with no field",
    JSON.stringify(unknownClosures)
  );
  const noHours = validateRequestedPickup({ entries: null, closures: [], dateString: MONDAY, timeLabel: "10:00 AM – 12:00 PM" });
  assert(!noHours.ok && noHours.code === "NO_HOURS", "Missing business hours reject the request");
  const badDate = validateRequestedPickup({ entries: ENTRIES, closures: [], dateString: "2027-02-30", timeLabel: "10:00 AM – 12:00 PM" });
  assert(!badDate.ok && badDate.code === "INVALID_DATE", "An impossible date is rejected");

  // The closure beats an otherwise valid time.
  assert(!validate(WEDNESDAY, "10:00 AM – 12:00 PM").ok, "A valid-looking time on a closure date is still rejected");

  // Wording stays customer-readable.
  const message = describePickupUnavailability({ status: "SPECIAL_CLOSURE", reason: "Festival holiday" }, WEDNESDAY);
  assert(
    /^The bakery is closed on \d{1,2} \w{3} 2027 \(Festival holiday\)\. Please choose another pickup date\.$/.test(message),
    "Closure message names the date and reason",
    message
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- The submit action validates before it writes (source contracts) ---");
{
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const action = read("lib/custom-cake/actions.ts");
  const form = read("components/custom-cake/custom-cake-form.tsx");
  const page = read("app/custom-cake/page.tsx");
  const queries = read("lib/hours/queries.ts");

  assert(
    !action.includes("buildIstPickupIso") && !/let hours = 16/.test(action) && !/hours = 16/.test(action),
    "The silent 16:00 fallback (buildIstPickupIso) is gone"
  );
  const validateAt = action.indexOf("validateRequestedPickup(");
  const rpcAt = action.indexOf("supabase.rpc(");
  assert(
    validateAt > 0 && rpcAt > 0 && validateAt < rpcAt,
    "Pickup is validated before submit_custom_request is invoked"
  );
  assert(
    /if \(!pickup\.ok\) \{\s*return \{ success: false, error: pickup\.message, field: pickup\.field \};/.test(action),
    "An invalid pickup returns an explicit failure with the field to show it at"
  );
  assert(
    action.includes("p_pickup: pickupIso") && action.includes("const pickupIso = pickup.pickupIso;"),
    "The RPC receives only the validated pickup timestamp"
  );
  assert(
    action.includes("getBusinessHoursData()") && action.includes("getSpecialClosures(pickupDate, pickupDate)"),
    "The action reuses the existing hours query and the closures query"
  );
  assert(/field\?: RequestedPickupField;/.test(action), "CustomCakeSubmitResult can carry the field");

  assert(
    /export const getSpecialClosures = cache\(/.test(queries) &&
      queries.includes('.from("special_closures")') &&
      queries.includes('.eq("location_id", locationId)') &&
      /if \(error \|\| !rows\) return null;/.test(queries),
    "getSpecialClosures is scoped to the location and returns null (not []) on failure"
  );

  assert(
    /specialClosures=\{specialClosures\}/.test(page) && page.includes("getSpecialClosures(getEarliestCustomCakePickupDate())"),
    "The page loads upcoming closures and hands them to the form"
  );
  assert(
    form.includes("getPickupAvailability(businessHoursEntries, specialClosures, preferredPickupDate)") &&
      form.includes('id="preferredPickupDate-availability"') &&
      form.includes('id="preferredPickupTime-error"') &&
      form.includes("setDateError(nextDateError)") &&
      /nextDateError = dateCheck\.success\s*\? pickupUnavailableMessage/.test(form),
    "The form uses the shared availability, shows an inline note, and blocks submit with a date error"
  );
  const bannerCalls = [...form.matchAll(/setErrorMessage\(([^)\n]*)/g)].map((m) => m[1].trim()).filter((a) => a !== "null");
  assert(
    bannerCalls.length === 2,
    "The submit banner is still used only for server and network failures (field problems show at their field)",
    JSON.stringify(bannerCalls)
  );
}

console.log(failures === 0 ? "\nAll custom cake pickup tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
