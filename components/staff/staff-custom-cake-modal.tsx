"use client";

import * as React from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import type { CustomCakeRequest } from "@/lib/custom-cake/types";
import {
  acceptCustomCakeAsOrderAction,
  updateCustomCakeStatusAction,
} from "@/lib/custom-cake/staff-actions";
import {
  getStaffStatusBadgeClass,
  type CustomCakeStaffStatus,
} from "@/lib/staff/custom-cake-workflow";
import { formatOrderStatusLabel } from "@/lib/staff/formatters";

/**
 * Dialogs for the PENDING stage of a custom cake request (before an order exists).
 * Once accepted, the linked order is driven by the regular StaffStatusModal
 * (ready for pickup, collect payment & handover, cancel).
 */
export type CustomCakeModalType =
  | { type: "ACCEPT"; request: CustomCakeRequest; staffStatus: CustomCakeStaffStatus }
  | { type: "REJECT"; request: CustomCakeRequest; staffStatus: CustomCakeStaffStatus };

interface StaffCustomCakeModalProps {
  modal: CustomCakeModalType | null;
  onClose: () => void;
  onSuccess: (requestId: string) => void;
}

export function StaffCustomCakeModal({
  modal,
  onClose,
  onSuccess,
}: StaffCustomCakeModalProps) {
  if (!modal) return null;

  return (
    <StaffCustomCakeModalContent
      key={`${modal.type}-${modal.request.id}`}
      modal={modal}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function StaffCustomCakeModalContent({
  modal,
  onClose,
  onSuccess,
}: {
  modal: CustomCakeModalType;
  onClose: () => void;
  onSuccess: (requestId: string) => void;
}) {
  const { request, type, staffStatus } = modal;

  // Pre-fill the agreed price from the latest existing quote, if any
  const initialPrice = React.useMemo(() => {
    const quotes = [...(request.custom_cake_quotes ?? [])].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return quotes[0] ? String(quotes[0].price_paise / 100) : "";
  }, [request]);

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [price, setPrice] = React.useState(initialPrice);
  // Optional. Starts as the customer's requested pickup so leaving it unchanged (or
  // clearing it) keeps their schedule; editing it confirms a different time.
  const requestedPickupValue = React.useMemo(
    () => toLocalInputValue(request.preferred_pickup_at),
    [request.preferred_pickup_at]
  );
  const [pickupAt, setPickupAt] = React.useState(requestedPickupValue);
  const [note, setNote] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (type === "ACCEPT") {
        const rupees = Number(price);
        if (!price.trim() || !Number.isFinite(rupees) || rupees <= 0) {
          setErrorMessage("Enter the agreed price for this cake.");
          setIsSubmitting(false);
          return;
        }
        let confirmedPickupAt: string | undefined;
        // Only send a value when staff actually changed it from the customer's request
        if (pickupAt.trim() && pickupAt !== requestedPickupValue) {
          const pickup = new Date(pickupAt);
          if (Number.isNaN(pickup.getTime())) {
            setErrorMessage("Enter a valid Confirmed Pickup / Ready Time or leave it empty.");
            setIsSubmitting(false);
            return;
          }
          confirmedPickupAt = pickup.toISOString();
        }

        const res = await acceptCustomCakeAsOrderAction({
          requestId: request.id,
          pricePaise: Math.round(rupees * 100),
          confirmedPickupAt,
          note: note.trim() || undefined,
        });
        if (!res.success) {
          setErrorMessage(res.error || "Failed to accept this request.");
          setIsSubmitting(false);
          return;
        }
      } else {
        if (!note.trim()) {
          setErrorMessage("A rejection reason is required.");
          setIsSubmitting(false);
          return;
        }
        const res = await updateCustomCakeStatusAction({
          requestId: request.id,
          toStatus: "DECLINED",
          message: note.trim(),
        });
        if (!res.success) {
          setErrorMessage(res.error || "Failed to reject this request.");
          setIsSubmitting(false);
          return;
        }
      }

      onSuccess(request.id);
      onClose();
    } catch (err) {
      console.error("[StaffCustomCakeModal] Error:", err);
      setErrorMessage("An unexpected error occurred. Please try again.");
      setIsSubmitting(false);
    }
  };

  const title =
    type === "ACCEPT"
      ? "Accept Custom Cake & Confirm Schedule"
      : "Reject Custom Cake Request";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-cake-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-cocoa/40 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-sm border border-border bg-card p-6 shadow-md space-y-5 animate-in fade-in-50 zoom-in-95 duration-150">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 id="custom-cake-modal-title" className="font-heading text-lg font-bold text-foreground">
              {title}
            </h2>
            <p className="text-xs text-muted-foreground">
              Request <span className="font-mono font-semibold text-foreground">{request.request_number}</span> · {request.customer_name}
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span>Current status:</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide border ${getStaffStatusBadgeClass(staffStatus)}`}
              >
                {formatOrderStatusLabel(staffStatus)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {type === "ACCEPT" && (
            <div className="space-y-3">
              <div className="rounded-sm border border-border bg-background p-3 text-xs space-y-1">
                <span className="text-muted-foreground">Requested Pickup (customer):</span>
                <span className="font-semibold text-foreground block">
                  {new Date(request.preferred_pickup_at).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>

              <div>
                <label
                  htmlFor="agreedPrice"
                  className="block text-xs font-semibold uppercase tracking-wider text-foreground mb-1.5"
                >
                  Agreed Price (₹) <span className="text-destructive">*</span>
                </label>
                <input
                  id="agreedPrice"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  required
                  placeholder="e.g. 2400"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full min-h-[42px] rounded-sm border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
                />
              </div>

              <div>
                <label
                  htmlFor="confirmedPickup"
                  className="block text-xs font-semibold uppercase tracking-wider text-foreground mb-1.5"
                >
                  Confirmed Pickup / Ready Time
                </label>
                <input
                  id="confirmedPickup"
                  type="datetime-local"
                  value={pickupAt}
                  onChange={(e) => setPickupAt(e.target.value)}
                  className="w-full min-h-[42px] rounded-sm border border-border bg-background px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Optional. Pre-filled with the customer&apos;s requested pickup; change it only to confirm a different time.
                </p>
              </div>

              <div>
                <label
                  htmlFor="acceptNote"
                  className="block text-xs font-semibold uppercase tracking-wider text-foreground mb-1.5"
                >
                  Optional Note / Memo
                </label>
                <input
                  id="acceptNote"
                  type="text"
                  placeholder="e.g. Agreed on sugar paste figurines"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full min-h-[42px] rounded-sm border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Accepting creates the order for this cake. You can then mark it ready
                for pickup and collect payment at handover.
              </p>
            </div>
          )}

          {type === "REJECT" && (
            <div className="space-y-3">
              <div className="rounded-sm border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
                Rejecting this request closes it and records your reason in the audit log.
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Kitchen at capacity on date",
                  "Design not feasible with current ingredients",
                  "Insufficient lead time",
                  "Customer requested cancellation",
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setNote(preset)}
                    className="rounded-sm border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-caramel hover:bg-caramel/5"
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div>
                <label
                  htmlFor="rejectReason"
                  className="block text-xs font-semibold uppercase tracking-wider text-foreground mb-1.5"
                >
                  Rejection Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="rejectReason"
                  required
                  rows={3}
                  placeholder="Explain why this custom cake request cannot be accommodated..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-sm border border-border bg-background p-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-10 px-4 rounded-sm border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`h-10 px-5 rounded-sm text-xs font-semibold text-white flex items-center gap-1.5 disabled:opacity-70 ${
                type === "REJECT"
                  ? "bg-destructive hover:bg-destructive/90"
                  : "bg-caramel hover:bg-caramel/90"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Updating...</span>
                </>
              ) : (
                <span>{type === "ACCEPT" ? "Accept Order" : "Reject Request"}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
