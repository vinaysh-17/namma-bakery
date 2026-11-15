"use client";

import * as React from "react";
import { Calendar } from "lucide-react";
import { generatePickupDateOptions } from "@/lib/pickup/utils";
import { getPickupScheduleWindow, weekdayForDateString } from "@/lib/pickup/queries";
import type { PickupDateOption } from "@/lib/pickup/types";

interface PickupDatePickerProps {
  selectedDate: string | null;
  onSelectDate: (dateString: string) => void;
  daysAhead?: number;
}

export function PickupDatePicker({
  selectedDate,
  onSelectDate,
  daysAhead = 10,
}: PickupDatePickerProps) {
  // Base calendar cells (labels, short day names, etc). Availability is overridden
  // below once the weekly-hours / special-closure schedule has been fetched.
  const baseDateOptions = React.useMemo(() => {
    return generatePickupDateOptions(daysAhead);
  }, [daysAhead]);

  const [retryNonce, setRetryNonce] = React.useState(0);
  // Identifies the exact horizon + retry attempt a fetched schedule answers, the same
  // key-comparison idiom PickupSelector uses for its slot fetch: "loading" is derived
  // by comparing keys rather than set explicitly, so nothing calls setState merely to
  // flip a status flag at the start of an effect.
  const scheduleKey = `${baseDateOptions[0]?.dateString ?? ""}-${
    baseDateOptions[baseDateOptions.length - 1]?.dateString ?? ""
  }-${retryNonce}`;

  const [scheduleData, setScheduleData] = React.useState<{
    key: string;
    closedWeekdays: Set<number>;
    specialClosures: Record<string, string>;
    error: boolean;
  }>({ key: "", closedWeekdays: new Set(), specialClosures: {}, error: false });

  const isScheduleLoading = scheduleData.key !== scheduleKey;

  // Fetch the schedule for the whole visible horizon once (not per calendar cell).
  React.useEffect(() => {
    if (baseDateOptions.length === 0) return;
    let isCancelled = false;

    const startDate = baseDateOptions[0].dateString;
    const endDate = baseDateOptions[baseDateOptions.length - 1].dateString;

    getPickupScheduleWindow({ startDate, endDate })
      .then((result) => {
        if (isCancelled) return;
        if (result.error) {
          setScheduleData({ key: scheduleKey, closedWeekdays: new Set(), specialClosures: {}, error: true });
          return;
        }
        setScheduleData({
          key: scheduleKey,
          closedWeekdays: new Set(result.closedWeekdays),
          specialClosures: result.specialClosures,
          error: false,
        });
      })
      .catch(() => {
        if (isCancelled) return;
        setScheduleData({ key: scheduleKey, closedWeekdays: new Set(), specialClosures: {}, error: true });
      });

    return () => {
      isCancelled = true;
    };
  }, [baseDateOptions, scheduleKey]);

  // Overlay real availability onto the base calendar cells. While the schedule is
  // unknown (loading or failed), every date is disabled rather than defaulting open.
  const dateOptions: Array<PickupDateOption & { closedKind?: "weekly" | "special" }> =
    React.useMemo(() => {
      return baseDateOptions.map((option) => {
        if (isScheduleLoading || scheduleData.error) {
          return {
            ...option,
            isAvailable: false,
            disabledReason: scheduleData.error ? "Availability unknown" : "Checking availability",
          };
        }

        const specialReason = scheduleData.specialClosures[option.dateString];
        if (specialReason) {
          return { ...option, isAvailable: false, disabledReason: specialReason, closedKind: "special" };
        }

        if (scheduleData.closedWeekdays.has(weekdayForDateString(option.dateString))) {
          return {
            ...option,
            isAvailable: false,
            disabledReason: "Bakery closed on this day",
            closedKind: "weekly",
          };
        }

        return { ...option, isAvailable: true };
      });
    }, [baseDateOptions, isScheduleLoading, scheduleData]);

  const handleRetry = React.useCallback(() => setRetryNonce((n) => n + 1), []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label
          id="pickup-date-label"
          className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-foreground uppercase"
        >
          <Calendar className="h-4 w-4 text-caramel" aria-hidden="true" />
          <span>1. Select Pickup Date</span>
        </label>
        <span className="text-[11px] text-muted-foreground">
          Asia/Kolkata (IST)
        </span>
      </div>

      {scheduleData.error && (
        <div
          role="status"
          className="rounded-sm border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center justify-between gap-3"
        >
          <span>Unable to check bakery availability for these dates.</span>
          <button
            type="button"
            onClick={handleRetry}
            className="shrink-0 rounded-xs border border-destructive/40 bg-destructive/20 px-2.5 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Responsive scrollable date cards */}
      <div
        role="group"
        aria-labelledby="pickup-date-label"
        aria-busy={isScheduleLoading}
        className="flex gap-2 overflow-x-auto pb-2 pt-1 no-scrollbar sm:grid sm:grid-cols-5 sm:gap-2.5 sm:overflow-visible"
      >
        {dateOptions.map((option) => {
          const isSelected = selectedDate === option.dateString;
          const accessibleName = `${option.dayName}, ${option.formattedDate}${
            isSelected ? ", selected" : ""
          }${!option.isAvailable && option.disabledReason ? `, ${option.disabledReason}` : ""}`;

          return (
            <button
              key={option.dateString}
              type="button"
              disabled={!option.isAvailable}
              onClick={() => onSelectDate(option.dateString)}
              aria-pressed={isSelected}
              aria-label={accessibleName}
              title={!option.isAvailable ? option.disabledReason : undefined}
              className={`flex min-h-[58px] min-w-[104px] shrink-0 flex-col items-center justify-center rounded-sm border px-3 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel ${
                isSelected
                  ? "border-2 border-caramel bg-caramel/10 text-caramel font-semibold shadow-xs"
                  : option.isAvailable
                  ? "border-border bg-card text-foreground hover:border-caramel/50 hover:bg-secondary/60"
                  : "cursor-not-allowed border-border/40 bg-muted/40 text-muted-foreground/50 line-through"
              }`}
            >
              <span
                className={`text-xs ${
                  isSelected ? "font-bold text-caramel" : "font-medium text-muted-foreground"
                }`}
              >
                {option.shortDay}
              </span>
              <span
                className={`mt-0.5 font-heading text-sm sm:text-base ${
                  isSelected ? "font-bold text-caramel" : "font-semibold text-foreground"
                }`}
              >
                {option.formattedDate.replace(` ${new Date().getFullYear()}`, "")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
