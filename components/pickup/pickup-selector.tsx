"use client";

import * as React from "react";
import { CheckCircle2, Clock, MapPin, Store } from "lucide-react";
import { useCart } from "@/lib/cart/context";
import { getAvailablePickupSlots } from "@/lib/pickup/queries";
import type { PickupSlot } from "@/lib/pickup/types";
import { formatPickupSelectionSummary } from "@/lib/pickup/utils";
import { useOrderingPausedStatus } from "@/lib/pickup/use-store-status";
import { getIstDateString } from "@/lib/utils/date";
import { OrderingPausedBanner } from "@/components/store/ordering-paused-banner";
import { PickupDatePicker } from "./pickup-date-picker";
import { PickupSlotPicker } from "./pickup-slot-picker";
import { PickupSlotNotice } from "./pickup-slot-notice";

export function PickupSelector() {
  const {
    items,
    pickupDate,
    pickupSlot,
    pickupSlotNotice,
    setPickupDate,
    setPickupSlot,
  } = useCart();

  const todayStr = React.useMemo(() => getIstDateString(), []);
  const activeDate = pickupDate || todayStr;

  // Paused-ordering status (#74): shown here so customers see it before they pick a
  // slot, not only after place_order rejects the order at the very end of checkout.
  const pausedStatus = useOrderingPausedStatus();

  // Maximum lead time among all items in cart
  const maxLeadMinutes = React.useMemo(() => {
    if (items.length === 0) return 0;
    return Math.max(0, ...items.map((i) => i.leadTimeMinutes ?? 0));
  }, [items]);

  const [retryNonce, setRetryNonce] = React.useState(0);
  const queryKey = `${activeDate}-${maxLeadMinutes}-${retryNonce}`;

  const [slotData, setSlotData] = React.useState<{
    key: string;
    slots: PickupSlot[];
    closureReason: string | null;
    error: string | null;
  }>({
    key: "",
    slots: [],
    closureReason: null,
    error: null,
  });

  const isLoadingSlots = slotData.key !== queryKey;
  const slots = slotData.slots;
  const closureReason = slotData.closureReason;
  const slotError = slotData.error;

  const handleRetry = React.useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  // Fetch or calculate available slots whenever date or items change
  React.useEffect(() => {
    let isCancelled = false;

    getAvailablePickupSlots({
      dateString: activeDate,
      minLeadMinutes: maxLeadMinutes,
    })
      .then((result) => {
        if (isCancelled) return;
        setSlotData({
          key: queryKey,
          slots: result.slots,
          closureReason: result.closureReason ?? null,
          error: result.error ?? null,
        });
      })
      .catch(() => {
        if (isCancelled) return;
        setSlotData({
          key: queryKey,
          slots: [],
          closureReason: null,
          error: "SLOT_FETCH_FAILED",
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [activeDate, maxLeadMinutes, queryKey]);

  const handleSelectDate = (newDate: string) => {
    setPickupDate(newDate);
  };

  const handleSelectSlot = (newSlot: PickupSlot) => {
    if (!pickupDate) {
      setPickupDate(activeDate);
    }
    setPickupSlot(newSlot);
  };

  const activeDateLabel = React.useMemo(() => {
    if (!activeDate) return "";
    return formatPickupSelectionSummary(activeDate);
  }, [activeDate]);

  return (
    <div className="rounded-sm border border-border bg-card p-5 sm:p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-kannada text-xs font-medium text-caramel">
              ಬೇಕರಿ ಕೌಂಟರ್ ಪಿಕಪ್
            </span>
            <h2 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Select Pickup Date &amp; Time
            </h2>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-xs border border-border bg-secondary/50 px-2.5 py-1 text-xs text-muted-foreground">
            <Store className="h-3.5 w-3.5 text-caramel" />
            <span>Counter Pickup Only</span>
          </div>
        </div>

        {/* Store pickup counter note */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-caramel shrink-0" />
            <span>BEML Layout 3rd Stage, RR Nagar</span>
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-caramel shrink-0" />
            <span>Counter Hours: 10:00 AM – 9:30 PM (Daily)</span>
          </span>
        </div>

        {/* Lead time notice if applicable */}
        {maxLeadMinutes >= 60 && (
          <div className="mt-3 rounded-sm border border-border/80 bg-secondary/40 p-2.5 text-xs text-foreground">
            <span className="font-semibold text-caramel">Fresh Preparation Lead Time:</span>{" "}
            Cakes or custom bakes in your cart require {Math.round(maxLeadMinutes / 60)} hours
            kitchen prep. Available time slots reflect this lead time.
          </div>
        )}
      </div>

      {/* Online ordering paused by the bakery (#74) */}
      <OrderingPausedBanner status={pausedStatus} />

      {/* Why the previously chosen time was cleared (#76) */}
      <PickupSlotNotice message={pickupSlotNotice} />

      {/* 1. Date Picker */}
      <PickupDatePicker
        selectedDate={activeDate}
        onSelectDate={handleSelectDate}
      />

      {/* 2. Slot Picker */}
      {isLoadingSlots ? (
        <PickupSlotPicker
          slots={[]}
          selectedSlot={pickupSlot}
          onSelectSlot={handleSelectSlot}
          isLoading={true}
          selectedDateLabel={activeDateLabel}
        />
      ) : closureReason ? (
        <div className="rounded-sm border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
          <p className="font-semibold">Bakery Closed</p>
          <p className="mt-1">{closureReason}</p>
        </div>
      ) : slotError ? (
        <div
          role="status"
          className="rounded-sm border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive"
        >
          <p className="font-semibold">Unable to Load Pickup Slots</p>
          <p className="mt-1">
            We could not check available pickup slots for this date. Please check your connection and try again.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xs border border-destructive/40 bg-destructive/20 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer"
          >
            Try Again
          </button>
        </div>
      ) : (
        <PickupSlotPicker
          slots={slots}
          selectedSlot={pickupSlot}
          onSelectSlot={handleSelectSlot}
          isLoading={false}
          selectedDateLabel={activeDateLabel}
        />
      )}

      {/* Selected Slot Feedback Banner */}
      <div className="border-t border-border pt-4">
        {pickupDate && pickupSlot ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-3 rounded-sm border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <div>
              <span className="font-semibold block">Pickup scheduled:</span>
              <span className="text-[13px] font-medium text-emerald-900 dark:text-emerald-300">
                {formatPickupSelectionSummary(pickupDate, pickupSlot.formattedTime)}
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            Please choose a pickup time slot above to complete scheduling.
          </div>
        )}
      </div>
    </div>
  );
}
