import {
  BAKERY_TIMEZONE,
  formatIstDate,
  getIstDateString,
} from "@/lib/utils/date";
import type { PickupDateOption } from "./types";

/**
 * Default number of days ahead customer can schedule a bakery pickup.
 */
export const DEFAULT_DAYS_AHEAD = 10;

/**
 * Generates an array of selectable pickup date options in Asia/Kolkata (IST),
 * starting from today.
 */
export function generatePickupDateOptions(
  daysAhead: number = DEFAULT_DAYS_AHEAD,
  now: Date = new Date()
): PickupDateOption[] {
  const options: PickupDateOption[] = [];
  const todayStr = getIstDateString(now);

  // Parse today at noon IST to avoid day boundary drift when adding days
  const baseDate = new Date(`${todayStr}T12:00:00+05:30`);

  for (let i = 0; i < daysAhead; i++) {
    const current = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateString = getIstDateString(current);

    const isToday = i === 0;
    const isTomorrow = i === 1;

    const formattedDate = formatIstDate(current, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const weekdayShort = new Intl.DateTimeFormat("en-IN", {
      timeZone: BAKERY_TIMEZONE,
      weekday: "short",
    }).format(current);

    const dayName = new Intl.DateTimeFormat("en-IN", {
      timeZone: BAKERY_TIMEZONE,
      weekday: "long",
    }).format(current);

    let shortDay = weekdayShort;
    let label = `${weekdayShort}, ${formatIstDate(current, { day: "numeric", month: "short" })}`;

    if (isToday) {
      shortDay = "Today";
      label = `Today, ${formatIstDate(current, { day: "numeric", month: "short" })}`;
    } else if (isTomorrow) {
      shortDay = "Tomorrow";
      label = `Tomorrow, ${formatIstDate(current, { day: "numeric", month: "short" })}`;
    }

    options.push({
      dateString,
      label,
      shortDay,
      dayName,
      formattedDate,
      isToday,
      isTomorrow,
      isAvailable: true,
    });
  }

  return options;
}

/**
 * Friendly summary for a selected pickup date and slot.
 *
 * Example:
 *   "Friday, 23 Oct 2026 · 10:30 AM – 11:00 AM"
 */
export function formatPickupSelectionSummary(
  dateString: string,
  formattedTime?: string
): string {
  const date = new Date(`${dateString}T12:00:00+05:30`);
  const fullDate = formatIstDate(date, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  if (formattedTime) {
    return `${fullDate} · ${formattedTime}`;
  }

  return fullDate;
}

/**
 * Short badge label for a disabled pickup slot (GitHub issue #97). The real
 * getAvailablePickupSlots() only ever sets disabledReason to "Slot is full" (capacity)
 * or "Slot passed" -- any other value is an unrecognised future reason, which must not
 * be mislabeled as "Prep" (a leftover label from the removed generator fallback).
 */
export function getSlotBadgeLabel(disabledReason: string | undefined): string {
  switch (disabledReason) {
    case "Slot passed":
      return "Passed";
    case "Slot is full":
      return "Full";
    default:
      return "Unavailable";
  }
}
