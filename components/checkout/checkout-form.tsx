"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { useCart } from "@/lib/cart/context";
import {
  customerDetailsSchema,
  type CustomerDetailsFormInput,
} from "@/lib/checkout/validation";
import { placeOrderAction } from "@/lib/orders/actions";
import { CustomerDetailsForm } from "./customer-details-form";
import { CheckoutPickupSummary } from "./checkout-pickup-summary";
import { PaymentMethodNote } from "./payment-method-note";
import { CheckoutOrderSummary } from "./checkout-order-summary";
import { formatPaise } from "@/lib/utils/money";
import { createIdempotencyKey } from "@/lib/orders/idempotency";
import { useCartValidation } from "@/lib/cart/use-cart-validation";
import { CartChangesNotice } from "./cart-changes-notice";
import { validatePickupSlotAction } from "@/lib/pickup/actions";
import { describeInvalidSlot } from "@/lib/pickup/slot-validity";
import { formatPickupSelectionSummary } from "@/lib/pickup/utils";
import { useOrderingPausedStatus } from "@/lib/pickup/use-store-status";
import { OrderingPausedBanner } from "@/components/store/ordering-paused-banner";

// Codes returned by placeOrderAction when the chosen pickup time cannot be used (#76)
const PICKUP_TIME_CODES = new Set([
  "LEAD_TIME_NOT_MET",
  "SLOT_FULL",
  "OUTSIDE_OPENING_HOURS",
  "CLOSED_DAY",
]);

// Codes returned by placeOrderAction when the cart no longer matches the live menu (#75)
const CART_CHANGED_CODES = new Set([
  "PRICE_CHANGED",
  "PRODUCT_NOT_FOUND",
  "PRODUCT_UNAVAILABLE",
  "OPTION_NOT_AVAILABLE",
]);

export function CheckoutForm({ hoursLabel }: { hoursLabel?: string | null }) {
  const router = useRouter();
  // The idempotency key of the current checkout attempt. It is reused when the SAME order is
  // submitted again after an unknown outcome (lost response), and replaced as soon as the
  // attempt is definitively finished or the order content changes.
  const attemptRef = React.useRef<{ key: string; fingerprint: string } | null>(null);
  // Synchronous double-submit guard (state updates are asynchronous)
  const inFlightRef = React.useRef(false);
  const {
    items,
    itemCount,
    subtotalPaise,
    isEmpty,
    isHydrated,
    pickupDate,
    pickupSlot,
    clearCart,
    applyLivePrices,
    removeItems,
    pickupSlotNotice,
    invalidatePickupSlot,
  } = useCart();

  // Live menu check (#75): shows what changed since the items were added to the cart
  const cartValidation = useCartValidation(items, isHydrated && !isEmpty);
  const cartIssues = cartValidation.issues;
  const hasCartIssues = cartIssues.length > 0;

  // Paused-ordering status (#74): blocks final submission with a clear reason instead
  // of letting placeOrderAction fail with ORDERS_PAUSED only after the customer submits.
  // Called unconditionally here (before the isHydrated/isEmpty early returns below) so
  // hook call order never varies between renders.
  const pausedStatus = useOrderingPausedStatus();

  const [formData, setFormData] = React.useState<CustomerDetailsFormInput>({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    customerNotes: "",
  });

  const [errors, setErrors] = React.useState<
    Partial<Record<keyof CustomerDetailsFormInput, string>>
  >({});

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const handleFieldChange = React.useCallback(
    (field: keyof CustomerDetailsFormInput, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      // Clear specific field error as user types
      setErrors((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
      if (submitError) {
        setSubmitError(null);
      }
    },
    [submitError]
  );

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting || inFlightRef.current) return;

    // 1. Guard against empty cart or missing pickup slot
    if (isEmpty || !pickupSlot?.slotStart) {
      setSubmitError("Please ensure you have items and a pickup slot selected.");
      return;
    }

    // 2. Validate customer details
    const result = customerDetailsSchema.safeParse(formData);

    if (!result.success) {
      const fieldErrors: Partial<Record<keyof CustomerDetailsFormInput, string>> =
        {};
      for (const issue of result.error.issues) {
        const path = issue.path[0] as keyof CustomerDetailsFormInput;
        if (path && !fieldErrors[path]) {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);

      // Focus first invalid input
      const firstErrorField = Object.keys(fieldErrors)[0];
      if (firstErrorField) {
        const element = document.getElementById(firstErrorField);
        element?.focus();
      }
      return;
    }

    setErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    inFlightRef.current = true;

    try {
      // 3. Prepare payload for server-side verification and order placement
      const itemsPayload = items.map((item) => ({
        productId: item.productId,
        kind: item.kind,
        variantId: item.variantId,
        quantity: item.quantity,
        cakeConfig: item.configuration
          ? {
              weightGrams: item.configuration.weightGrams,
              eggType: item.configuration.eggType,
              finish: item.configuration.finish,
            }
          : undefined,
        // The price the customer saw. The database compares it with the live price and refuses
        // the order if it changed; it is never used to price the order (#75).
        expectedUnitPricePaise: item.unitPricePaise,
        // Order notes are not a per-cake inscription: they can mention several cakes or
        // pickup details. Staff read them in full as "Customer Instructions" on the order.
      }));

      // Same order content as the previous (unconfirmed) attempt => same key, so a retry after
      // a lost response returns the order that was already placed. Any change => a new key.
      const fingerprint = JSON.stringify({
        customer: result.data,
        pickup: pickupSlot.slotStart,
        items: itemsPayload,
      });
      // A retry of an attempt whose outcome is unknown must go straight to the server: that
      // order may already exist (it may even be what filled the slot), and the database
      // answers a replay with the original order before it looks at the slot (#98).
      const isRetryOfUnconfirmedAttempt = attemptRef.current?.fingerprint === fingerprint;
      if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint) {
        attemptRef.current = { key: createIdempotencyKey(), fingerprint };
      }

      // Order of checks: live cart/menu (#75, the button is disabled while it has issues),
      // then the chosen pickup time against the cart's CURRENT lead time (#76), then the order.
      // The pickup check is read-only; if it cannot run, place_order still decides.
      if (!isRetryOfUnconfirmedAttempt) {
        try {
          const slotCheck = await validatePickupSlotAction({
            productIds: Array.from(new Set(items.map((item) => item.productId))),
            slotStart: pickupSlot.slotStart,
          });
          if (slotCheck.success && !slotCheck.valid) {
            // Nothing was sent to place_order: no order, and the key is not used
            attemptRef.current = null;
            inFlightRef.current = false;
            invalidatePickupSlot(
              describeInvalidSlot(
                slotCheck.reason,
                pickupDate
                  ? formatPickupSelectionSummary(pickupDate, pickupSlot.formattedTime)
                  : pickupSlot.formattedTime,
                slotCheck.requiredLeadMinutes
              )
            );
            setIsSubmitting(false);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
        } catch {
          // Could not check (network): continue, the database validates the pickup time
        }
      }
      if (!attemptRef.current) {
        // Not reachable: the pre-check only clears the attempt when it returns. Kept so the
        // key used below is always the one for this exact order content.
        attemptRef.current = { key: createIdempotencyKey(), fingerprint };
      }

      const actionResult = await placeOrderAction({
        customerDetails: result.data,
        pickupSlotStart: pickupSlot.slotStart,
        items: itemsPayload,
        idempotencyKey: attemptRef.current.key,
      });

      if (!actionResult.success) {
        // The server answered with a definite refusal (no order was created): the next
        // submit is a fresh attempt with a new key.
        attemptRef.current = null;
        inFlightRef.current = false;
        setSubmitError(actionResult.error);
        setIsSubmitting(false);
        // The cart no longer matches the menu: show exactly which items changed
        if (actionResult.code && CART_CHANGED_CODES.has(actionResult.code)) {
          void cartValidation.recheck();
        }
        // The database refused the pickup time: clear it so the customer chooses another one
        if (actionResult.code && PICKUP_TIME_CODES.has(actionResult.code)) {
          invalidatePickupSlot(actionResult.error);
          setSubmitError(null);
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // 4. On confirmed success: clear cart state and redirect to order tracking route
      attemptRef.current = null;
      clearCart();
      router.push(`/orders/${actionResult.publicToken}?confirmed=true`);
    } catch (err) {
      // Unknown outcome: the order may or may not have been placed. Keep the SAME key so
      // "try again" cannot create a duplicate.
      console.error("[CheckoutForm] Submission failed:", err);
      inFlightRef.current = false;
      setSubmitError(
        "A connection issue occurred while submitting your order. Please check your network and try again. If your order was already placed, retrying will not create a second one."
      );
      setIsSubmitting(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // SSR / Hydration placeholder
  if (!isHydrated) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 rounded bg-muted/60" />
          <div className="h-64 rounded-sm border border-border bg-card/60" />
        </div>
      </div>
    );
  }

  // Empty cart state
  if (isEmpty) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-24 text-center">
        <div className="flex h-20 w-20 mx-auto items-center justify-center rounded-full bg-caramel/10 text-caramel">
          <ShoppingBag className="h-10 w-10" aria-hidden="true" />
        </div>
        <span className="mt-6 font-kannada text-sm font-medium text-caramel block">
          ನಿಮ್ಮ ಕಾರ್ಟ್ ಖಾಲಿಯಾಗಿದೆ
        </span>
        <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Your cart is empty
        </h1>
        <p className="mt-3 max-w-md mx-auto text-sm leading-relaxed text-muted-foreground sm:text-base">
          You don&apos;t have any treats in your cart yet. Please select items from our menu before checking out.
        </p>
        <div className="mt-8">
          <Link
            href="/menu"
            className="inline-flex h-12 items-center justify-center rounded-sm bg-caramel px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-caramel/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
          >
            Explore Menu →
          </Link>
        </div>
      </div>
    );
  }

  const isPickupValid = Boolean(pickupDate && pickupSlot);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-3 pb-8 sm:px-6 sm:pt-4 sm:pb-12">
      {/* Navigation */}
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Link
          href="/cart"
          className="inline-flex min-h-[48px] items-center gap-1.5 transition-colors hover:text-caramel focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Cart &amp; Pickup</span>
        </Link>
      </nav>

      {/* Page Title */}
      <div className="mb-8 border-b border-border pb-6">
        <span className="font-kannada text-xs font-medium text-caramel block">
          ಆರ್ಡರ್ ಪರಿಶೀಲನೆ ಮತ್ತು ದೃಢೀಕರಣ
        </span>
        <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Bakery Checkout
        </h1>
        <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground">
          Review your order details and provide contact information for store pickup in RR Nagar.
        </p>
      </div>

      {/* Submission Error Banner */}
      {submitError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-6 flex items-start gap-2.5 rounded-sm border border-destructive/40 bg-destructive/10 p-3 sm:p-4 text-xs text-destructive dark:bg-destructive/20 sm:text-sm animate-in fade-in"
        >
          <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-0.5 min-w-0 flex-1">
            <p className="font-semibold text-xs sm:text-sm">Unable to place order</p>
            <p className="leading-relaxed text-[11px] sm:text-xs text-destructive/90 break-words">{submitError}</p>
          </div>
        </div>
      )}

      {/* Online ordering paused by the bakery (#74) */}
      <OrderingPausedBanner status={pausedStatus} className="mb-6" />

      {/* Live menu changes (#75): price changes and unavailable items */}
      <CartChangesNotice
        issues={cartIssues}
        onAcceptPrices={() => {
          applyLivePrices(
            cartIssues.flatMap((issue) =>
              issue.kind === "PRICE_CHANGED"
                ? [{ itemKey: issue.itemKey, unitPricePaise: issue.newUnitPricePaise }]
                : []
            )
          );
          setSubmitError(null);
        }}
        onRemoveUnavailable={() => {
          removeItems(
            cartIssues.flatMap((issue) => (issue.kind === "UNAVAILABLE" ? [issue.itemKey] : []))
          );
          setSubmitError(null);
        }}
      />

      {/* Missing Pickup Alert */}
      {!isPickupValid && (
        <div
          role="alert"
          className="mb-8 flex items-start gap-3 rounded-sm border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400 mt-0.5" aria-hidden="true" />
          <div className="space-y-2">
            <p className="font-semibold text-sm">
              {pickupSlotNotice ? "Please choose a new pickup time" : "Pickup slot selection is required"}
            </p>
            <p className="leading-relaxed">
              {pickupSlotNotice ??
                "You must select an available pickup date and time slot before your order can be placed."}
            </p>
            <Link
              href="/cart"
              className="inline-flex min-touch-target h-12 items-center justify-center rounded-sm bg-caramel px-4 text-xs font-semibold text-white transition-colors hover:bg-caramel/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
            >
              Choose Pickup Slot in Cart →
            </Link>
          </div>
        </div>
      )}

      {/* Main Grid: Form on left, Summary on right */}
      <form onSubmit={handleSubmitOrder} noValidate>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
          {/* Left Column: Customer details, Pickup details, Payment notice */}
          <div className="lg:col-span-7 space-y-6">
            {/* Customer Information Form */}
            <CustomerDetailsForm
              values={formData}
              onChange={handleFieldChange}
              errors={errors}
            />

            {/* Pickup Details Summary */}
            <CheckoutPickupSummary
              pickupDate={pickupDate}
              pickupSlot={pickupSlot}
              hoursLabel={hoursLabel}
            />

            {/* Payment Method Notice */}
            <PaymentMethodNote />

            {/* Action Buttons */}
            <div className="rounded-sm border border-border bg-card p-4 sm:p-6 space-y-4">
              {/* Mobile total preview (visible only on small screens < lg) */}
              <div className="lg:hidden flex items-center justify-between border-b border-border pb-3">
                <div>
                  <span className="text-xs text-muted-foreground block">
                    Order Total ({itemCount} {itemCount === 1 ? "item" : "items"})
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Pay at store counter
                  </span>
                </div>
                <span className="font-heading text-lg font-bold text-foreground">
                  {formatPaise(subtotalPaise)}
                </span>
              </div>

              <button
                type="submit"
                disabled={!isPickupValid || isSubmitting || hasCartIssues || pausedStatus.isPaused}
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-sm text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel ${
                  isPickupValid && !isSubmitting && !hasCartIssues && !pausedStatus.isPaused
                    ? "bg-caramel text-white shadow-sm hover:bg-caramel/90 active:scale-[0.99]"
                    : "cursor-not-allowed bg-muted text-muted-foreground"
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Placing Order with Bakery...</span>
                  </>
                ) : (
                  <>
                    <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {pausedStatus.isPaused
                        ? "Online Ordering Paused"
                        : !isPickupValid
                          ? "Select Pickup Slot to Continue"
                          : hasCartIssues
                            ? "Review Cart Changes to Continue"
                            : "Place Order (Pay at Bakery)"}
                    </span>
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-caramel/70 shrink-0" aria-hidden="true" />
                <span>
                  No payment required right now. Pay when you collect at the bakery counter.
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Order Items Review Summary */}
          <div className="lg:col-span-5">
            <CheckoutOrderSummary
              items={items}
              itemCount={itemCount}
              subtotalPaise={subtotalPaise}
              priceStatus={
                hasCartIssues
                  ? "changed"
                  : cartValidation.state === "done"
                    ? "verified"
                    : "unverified"
              }
            />
          </div>
        </div>
      </form>
    </div>
  );
}
