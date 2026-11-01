"use client";

import * as React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  getHistoryDetailAction,
  type HistoryDetail,
} from "@/lib/staff/order-history-actions";
import { StaffOrderDetail } from "@/components/staff/staff-order-detail";
import { StaffCustomCakeDetail } from "@/components/staff/staff-custom-cake-detail";
import { getCustomCakeStaffStatus } from "@/lib/staff/custom-cake-workflow";

interface HistoryDetailModalProps {
  kind: "normal" | "custom";
  id: string;
  onClose: () => void;
}

const noop = () => {};

/**
 * Read-only details of ONE history record. Mounted only after the user clicks that record
 * (the parent keys it by record, so each click starts a fresh load).
 * Reuses the existing staff order / custom cake detail components in readOnly mode:
 * no operations, no note forms.
 */
export function HistoryDetailModal({ kind, id, onClose }: HistoryDetailModalProps) {
  const [state, setState] = React.useState<{
    detail: HistoryDetail | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getHistoryDetailAction({ kind, id });
      if (cancelled) return;
      setState({
        detail: res.success && res.data ? res.data : null,
        error: res.success ? null : res.error ?? "Could not load the details.",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const detail = state?.detail ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Order details"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-cocoa/40 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl min-h-screen sm:min-h-0 sm:max-h-[90vh] overflow-y-auto rounded-none sm:rounded-sm border border-border bg-card shadow-md">
        {!state && (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading details&hellip;
          </div>
        )}

        {state?.error && (
          <div className="space-y-3 p-5">
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{state.error}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-sm border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
            >
              Close
            </button>
          </div>
        )}

        {detail?.kind === "normal" && (
          <StaffOrderDetail order={detail.order} role={null} onClose={onClose} onOpenModal={noop} readOnly />
        )}

        {detail?.kind === "custom" && (
          <StaffCustomCakeDetail
            request={detail.request}
            staffStatus={getCustomCakeStaffStatus(detail.request, detail.linkedOrder)}
            linkedOrder={detail.linkedOrder}
            onClose={onClose}
            onOpenModal={noop}
            onOpenOrderModal={noop}
            readOnly
          />
        )}
      </div>
    </div>
  );
}
