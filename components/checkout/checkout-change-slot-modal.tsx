"use client";

import * as React from "react";
import { X, Calendar, Clock } from "lucide-react";
import type { PickupSlot } from "@/lib/pickup/types";
import { getAvailablePickupSlots } from "@/lib/pickup/queries";
import { formatPickupSelectionSummary } from "@/lib/pickup/utils";
import { getIstDateString } from "@/lib/utils/date";
import { PickupDatePicker } from "@/components/pickup/pickup-date-picker";
import { PickupSlotPicker } from "@/components/pickup/pickup-slot-picker";

interface CheckoutChangeSlotModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDate: string | null;
  currentSlot: PickupSlot | null;
  maxLeadMinutes: number;
  onConfirm: (date: string, slot: PickupSlot) => void;
}

export function CheckoutChangeSlotModal({
  isOpen,
  onClose,
  currentDate,
  currentSlot,
  maxLeadMinutes,
  onConfirm,
}: CheckoutChangeSlotModalProps) {
  const todayStr = React.useMemo(() => getIstDateString(), []);
  const [selectedDate, setSelectedDate] = React.useState<string>(
    () => currentDate || todayStr
  );
  const [selectedSlot, setSelectedSlot] = React.useState<PickupSlot | null>(
    () => currentSlot
  );
  const [retryNonce, setRetryNonce] = React.useState(0);

  // Lock body scroll when modal is open
  React.useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // Handle Escape key
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Slot query key
  const queryKey = `${selectedDate}-${maxLeadMinutes}-${retryNonce}`;

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

  // Fetch slots whenever selectedDate or maxLeadMinutes changes
  React.useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    getAvailablePickupSlots({
      dateString: selectedDate,
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
  }, [isOpen, selectedDate, maxLeadMinutes, queryKey]);

  const handleSelectDate = (newDate: string) => {
    if (newDate === selectedDate) return;
    setSelectedDate(newDate);
    // If returning to initial date, restore currentSlot, else clear slot selection
    if (newDate === currentDate) {
      setSelectedSlot(currentSlot);
    } else {
      setSelectedSlot(null);
    }
  };

  const handleSelectSlot = (slot: PickupSlot) => {
    setSelectedSlot(slot);
  };

  const handleConfirm = () => {
    if (selectedDate && selectedSlot && selectedSlot.isAvailable) {
      onConfirm(selectedDate, selectedSlot);
      onClose();
    }
  };

  const selectedDateLabel = React.useMemo(() => {
    if (!selectedDate) return "";
    return formatPickupSelectionSummary(selectedDate);
  }, [selectedDate]);

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal / Bottom Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-slot-modal-title"
        className="relative z-50 w-full max-h-[85vh] sm:max-h-[88vh] sm:max-w-xl flex flex-col rounded-t-xl sm:rounded-lg border border-border bg-card shadow-2xl animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-caramel" aria-hidden="true" />
            <h2
              id="change-slot-modal-title"
              className="font-heading text-lg font-semibold text-foreground sm:text-xl"
            >
              Change Pickup Slot
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-sm p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto px-5 py-5 space-y-6 flex-1 overscroll-contain">
          {/* Lead time notice if applicable */}
          {maxLeadMinutes >= 60 && (
            <div className="rounded-sm border border-border/80 bg-secondary/40 p-3 text-xs text-foreground">
              <span className="font-semibold text-caramel">
                Fresh Preparation Lead Time:
              </span>{" "}
              Cakes or custom bakes in your cart require{" "}
              {Math.round(maxLeadMinutes / 60)} hours kitchen prep. Available time
              slots reflect this lead time.
            </div>
          )}

          {/* 1. Date Picker */}
          <div>
            <PickupDatePicker
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
            />
          </div>

          {/* 2. Slot Picker */}
          <div>
            {isLoadingSlots ? (
              <PickupSlotPicker
                slots={[]}
                selectedSlot={selectedSlot}
                onSelectSlot={handleSelectSlot}
                isLoading={true}
                selectedDateLabel={selectedDateLabel}
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
                  We could not check available pickup slots for this date. Please
                  check your connection and try again.
                </p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xs border border-destructive/40 bg-destructive/20 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <PickupSlotPicker
                slots={slots}
                selectedSlot={selectedSlot}
                onSelectSlot={handleSelectSlot}
                isLoading={false}
                selectedDateLabel={selectedDateLabel}
              />
            )}
          </div>

          {/* Current Selection Feedback */}
          {selectedDate && selectedSlot && (
            <div className="rounded-sm border border-border bg-secondary/30 p-3 text-xs">
              <span className="text-muted-foreground block text-[11px] font-medium uppercase tracking-wider">
                Selected Pickup Time:
              </span>
              <div className="flex items-center gap-1.5 font-semibold text-caramel text-sm mt-0.5">
                <Clock className="h-4 w-4" aria-hidden="true" />
                <span>
                  {formatPickupSelectionSummary(
                    selectedDate,
                    selectedSlot.formattedTime
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Actions Footer */}
        <div className="border-t border-border bg-card px-5 py-4 shrink-0 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[48px] items-center justify-center rounded-sm border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedSlot?.isAvailable}
            onClick={handleConfirm}
            className={`inline-flex min-h-[48px] items-center justify-center rounded-sm px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel ${
              selectedSlot?.isAvailable
                ? "bg-caramel text-white shadow-sm hover:bg-caramel/90 active:scale-[0.99] cursor-pointer"
                : "cursor-not-allowed bg-muted text-muted-foreground"
            }`}
          >
            Confirm Slot
          </button>
        </div>
      </div>
    </div>
  );
}
