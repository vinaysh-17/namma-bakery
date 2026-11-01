"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  LogOut,
  ShieldCheck,
  Sparkles,
  ShoppingBag,
} from "lucide-react";
import {
  sendFindOrdersOtpAction,
  verifyFindOrdersOtpAction,
  getMyOrdersAction,
  signOutFindOrdersAction,
} from "@/lib/customer/find-orders-actions";
import type { MyOrdersResult } from "@/lib/customer/find-orders-types";
import {
  formatCustomerOrderStatus,
  formatCustomerRequestStatus,
} from "@/lib/orders/status-labels";
import { formatPaise } from "@/lib/utils/money";
import { formatIstDate } from "@/lib/utils/date";

type Step = "phone" | "otp" | "results";

const RESEND_COOLDOWN_SECONDS = 30;

const inputClass =
  "w-full min-h-[48px] rounded-sm border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel hover:border-caramel/50 transition-colors";
const labelClass =
  "block text-xs font-semibold uppercase tracking-wider text-foreground mb-1.5";
const primaryButtonClass =
  "inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-sm bg-caramel px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-caramel/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel disabled:opacity-60 disabled:cursor-not-allowed";

export function FindMyOrders({ initial }: { initial: MyOrdersResult }) {
  const [step, setStep] = React.useState<Step>(
    initial.authenticated ? "results" : "phone"
  );
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [maskedPhone, setMaskedPhone] = React.useState(initial.maskedPhone ?? "");
  const [data, setData] = React.useState<MyOrdersResult>(initial);
  const [isBusy, setIsBusy] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(
    initial.error ?? null
  );
  const [cooldown, setCooldown] = React.useState(0);

  // Resend cooldown ticker
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!phone.trim()) {
      setErrorMessage("Please enter the phone number you used when placing your order.");
      return;
    }
    setErrorMessage(null);
    setIsBusy(true);
    try {
      const res = await sendFindOrdersOtpAction({ phone });
      if (!res.success) {
        setErrorMessage(res.error || "We couldn't send a code. Please try again.");
        return;
      }
      setMaskedPhone(res.maskedPhone ?? "");
      setCode("");
      setStep("otp");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setErrorMessage("A network error occurred. Please check your connection and try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(code.trim())) {
      setErrorMessage("Enter the verification code we sent you.");
      return;
    }
    setErrorMessage(null);
    setIsBusy(true);
    try {
      const res = await verifyFindOrdersOtpAction({ phone, code });
      if (!res.success) {
        setErrorMessage(res.error || "Verification failed. Please try again.");
        return;
      }
      const orders = await getMyOrdersAction();
      if (!orders.authenticated) {
        setErrorMessage("We couldn't confirm your session. Please verify again.");
        setStep("phone");
        return;
      }
      setData(orders);
      setErrorMessage(orders.error ?? null);
      setStep("results");
    } catch {
      setErrorMessage("A network error occurred. Please check your connection and try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const reload = async () => {
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const orders = await getMyOrdersAction();
      if (!orders.authenticated) {
        setStep("phone");
        setErrorMessage("Your session has expired. Please verify your phone number again.");
        return;
      }
      setData(orders);
      setErrorMessage(orders.error ?? null);
    } catch {
      setErrorMessage("A network error occurred. Please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const signOut = async () => {
    setIsBusy(true);
    await signOutFindOrdersAction();
    setData({ authenticated: false });
    setPhone("");
    setCode("");
    setErrorMessage(null);
    setStep("phone");
    setIsBusy(false);
  };

  const errorBanner = errorMessage && (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-sm border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive dark:bg-destructive/20"
    >
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{errorMessage}</span>
    </div>
  );

  // ---------------------------------------------------------------- phone step
  if (step === "phone") {
    return (
      <div className="rounded-sm border border-border bg-card p-6 sm:p-8 space-y-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-bold text-foreground">Find My Orders</h2>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Enter the phone number you used when placing your order.
          </p>
        </div>

        {errorBanner}

        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <div>
            <label htmlFor="findPhone" className={labelClass}>
              Phone number
            </label>
            <div className="relative flex items-center">
              <span
                className="absolute left-3.5 text-xs font-semibold text-muted-foreground select-none"
                aria-hidden="true"
              >
                +91
              </span>
              <input
                id="findPhone"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                placeholder="98450 12345"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                className={`${inputClass} pl-12`}
              />
            </div>
          </div>

          <button type="submit" disabled={isBusy} className={primaryButtonClass}>
            {isBusy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Sending code...</span>
              </>
            ) : (
              <span>Send OTP</span>
            )}
          </button>
          <p className="text-xs text-muted-foreground text-center">
            We&apos;ll send a verification code to confirm it&apos;s you.
          </p>
        </form>
      </div>
    );
  }

  // ---------------------------------------------------------------- OTP step
  if (step === "otp") {
    return (
      <div className="rounded-sm border border-border bg-card p-6 sm:p-8 space-y-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-bold text-foreground">Verify your phone</h2>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            We sent a verification code to{" "}
            <span className="font-semibold text-foreground">{maskedPhone}</span>.
          </p>
        </div>

        {errorBanner}

        <form onSubmit={verifyCode} className="space-y-4" noValidate>
          <div>
            <label htmlFor="findOtp" className={labelClass}>
              Verification Code
            </label>
            <input
              id="findOtp"
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              required
              placeholder="······"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ""));
                if (errorMessage) setErrorMessage(null);
              }}
              className={`${inputClass} text-center font-mono text-lg tracking-[0.5em]`}
            />
          </div>

          <button type="submit" disabled={isBusy} className={primaryButtonClass}>
            {isBusy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Verifying...</span>
              </>
            ) : (
              <span>Verify</span>
            )}
          </button>
        </form>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted-foreground">
          <span>Didn&apos;t receive it?</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => sendCode()}
              disabled={isBusy || cooldown > 0}
              className="min-h-[48px] font-semibold text-caramel hover:underline disabled:opacity-50 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
            >
              {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setErrorMessage(null);
              }}
              className="min-h-[48px] font-semibold text-foreground hover:underline cursor-pointer"
            >
              Change number
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- results
  const allOrders = data.orders ?? [];
  const customRequests = data.customRequests ?? [];
  // An accepted custom cake exists as a request (CC...) AND a linked order (NB...). They are
  // one purchase, so the order is shown inside the custom cake card, not as a second item.
  const linkedOrderNumbers = new Set(
    customRequests
      .map((r) => r.linked_order_number)
      .filter((n): n is string => Boolean(n))
  );
  const orders = allOrders.filter((o) => !linkedOrderNumbers.has(o.order_number));
  const hasAnything = orders.length > 0 || customRequests.length > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-sm border border-border bg-card p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="font-heading text-xl font-bold text-foreground">My Orders</h2>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-caramel" />
              <span>
                Verified {data.maskedPhone ?? maskedPhone}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={reload}
              disabled={isBusy}
              className="min-h-[48px] px-3 text-xs font-semibold text-caramel hover:underline disabled:opacity-50 cursor-pointer"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={signOut}
              disabled={isBusy}
              className="inline-flex min-h-[48px] items-center gap-1.5 px-3 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
            >
              <LogOut className="size-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
        {errorBanner}
      </div>

      {!hasAnything && !errorMessage && (
        <div className="rounded-sm border border-border bg-card p-6 text-center space-y-2 shadow-xs">
          <h3 className="font-heading text-base font-semibold text-foreground">
            No orders found for this phone number.
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Make sure you&apos;re using the same phone number you used when placing your order.
          </p>
        </div>
      )}

      {orders.length > 0 && (
        <section aria-label="Orders" className="space-y-2.5">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ShoppingBag className="size-3.5 text-caramel" />
            <span>Orders</span>
          </h3>
          {orders.map((order) => (
            <Link
              key={order.public_token}
              href={`/orders/${order.public_token}`}
              className="flex min-h-[48px] items-center justify-between gap-3 rounded-sm border border-border bg-card p-4 transition-colors hover:border-caramel/50 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-foreground">
                    {order.order_number}
                  </span>
                  <span className="rounded border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
                    {formatCustomerOrderStatus(order.status)}
                  </span>
                  {order.is_custom && (
                    <span className="rounded bg-caramel/10 px-1.5 py-0.5 text-[10px] font-semibold text-caramel">
                      Custom cake
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Placed {formatIstDate(order.created_at)} · Pickup{" "}
                  {formatIstDate(order.requested_pickup_at)} · {formatPaise(order.total_paise)}
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </section>
      )}

      {customRequests.length > 0 && (
        <section aria-label="Custom cakes" className="space-y-2.5">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5 text-caramel" />
            <span>Custom Cakes</span>
          </h3>
          {customRequests.map((req) => {
            const hasOrder = Boolean(req.linked_order_token && req.linked_order_status);
            return (
              <Link
                key={req.request_number}
                // Accepted: continue on the normal order tracking page; otherwise the tracker
                href={
                  hasOrder ? `/orders/${req.linked_order_token}` : "/custom-cake/track"
                }
                className="flex min-h-[48px] items-center justify-between gap-3 rounded-sm border border-border bg-card p-4 transition-colors hover:border-caramel/50 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-foreground">
                      {req.request_number}
                    </span>
                    <span className="rounded border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
                      {hasOrder
                        ? formatCustomerOrderStatus(req.linked_order_status as string)
                        : formatCustomerRequestStatus(req.status)}
                    </span>
                    {hasOrder && req.linked_order_number && (
                      <span className="rounded bg-caramel/10 px-1.5 py-0.5 text-[10px] font-semibold text-caramel">
                        Order {req.linked_order_number}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Requested {formatIstDate(req.created_at)} · Pickup{" "}
                    {formatIstDate(req.preferred_pickup_at)} · {req.flavour}
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
