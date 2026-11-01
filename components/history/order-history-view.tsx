"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Loader2, Trash2, X } from "lucide-react";
import {
  previewOrderDeletionAction,
  deleteOrderHistoryAction,
  cleanupReferencePhotosAction,
} from "@/lib/admin/order-history-actions";
import { listStaffOrderHistoryAction } from "@/lib/staff/order-history-actions";
import { HistoryDetailModal } from "./history-detail-modal";
import {
  TYPED_CONFIRM_THRESHOLD,
  dayRange,
  weekRange,
  monthRange,
  customRange,
  type DeletionMethod,
  type DeletionPreview,
  type HistoryRange,
  type HistoryItem,
  type HistoryItemList,
  type HistoryType,
} from "@/lib/admin/order-history-types";
import { formatOrderStatusLabel } from "@/lib/staff/formatters";
import { formatPaise } from "@/lib/utils/money";
import { formatIstDate, getIstDateString } from "@/lib/utils/date";

type RangeMode = "day" | "week" | "month" | "range";

interface DeleteDialog {
  ids: string[];
  method: DeletionMethod;
  /** Human description of what is being deleted, e.g. "1 November 2026" */
  label: string;
  preview: DeletionPreview | null;
  loading: boolean;
  error: string | null;
}

const MODE_LABELS: Record<RangeMode, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  range: "Custom range",
};

const TYPE_LABELS: Record<HistoryType, string> = {
  all: "All Orders",
  normal: "Regular Orders",
  custom: "Custom Cake Orders",
};

const BULK_BUTTON_LABELS: Record<RangeMode, string> = {
  day: "Delete Orders for This Day",
  week: "Delete Orders for This Week",
  month: "Delete Orders for This Month",
  range: "Delete Orders in This Range",
};

const fieldClass =
  "w-full min-h-[44px] rounded-sm border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel";

function statusBadgeClass(status: string): string {
  if (status === "COMPLETED") return "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900 dark:text-slate-300";
  return "bg-destructive/10 text-destructive border-destructive/30";
}

/**
 * Order History for admin AND staff.
 * canDelete = true (admin portal only): selection + deletion controls. The server and the
 * database still enforce admin-only deletion; this flag only decides what is rendered.
 * canDelete = false (staff portal): strictly read-only.
 */
export function OrderHistoryView({ canDelete }: { canDelete: boolean }) {
  const [mode, setMode] = React.useState<RangeMode>("month");
  const [type, setType] = React.useState<HistoryType>("all");
  // Opened ONLY by an explicit click on a history record
  const [detail, setDetail] = React.useState<{ kind: "normal" | "custom"; id: string } | null>(null);
  // Initialised once on the client (this view only mounts after a tab click)
  const [today] = React.useState(() => getIstDateString());
  const [dayValue, setDayValue] = React.useState(today);
  const [weekValue, setWeekValue] = React.useState(today);
  const [monthValue, setMonthValue] = React.useState(today.slice(0, 7));
  const [fromValue, setFromValue] = React.useState(today);
  const [toValue, setToValue] = React.useState(today);

  // Result of the latest fetch, tagged with the request it answers
  const [result, setResult] = React.useState<{
    key: string;
    list: HistoryItemList | null;
    error: string | null;
    range: HistoryRange;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const [dialog, setDialog] = React.useState<DeleteDialog | null>(null);
  const [confirmText, setConfirmText] = React.useState("");
  const [isDeleting, setIsDeleting] = React.useState(false);

  const currentRange = React.useMemo((): HistoryRange | null => {
    if (mode === "day") return dayRange(dayValue);
    if (mode === "week") return weekRange(weekValue);
    if (mode === "month") return monthRange(monthValue);
    return customRange(fromValue, toValue);
  }, [mode, dayValue, weekValue, monthValue, fromValue, toValue]);

  const requestKey = currentRange
    ? `${currentRange.from}|${currentRange.to}|${type}|${reloadNonce}`
    : null;

  // Admin only: remove reference photos queued by the automatic 3-month cleanup (the database
  // job cannot delete storage files). Fire-and-forget; sets no state.
  React.useEffect(() => {
    if (canDelete) void cleanupReferencePhotosAction();
  }, [canDelete]);

  // Fetch whenever the chosen range changes or a reload is requested. State is only set
  // after the awaited server call (never synchronously inside the effect).
  React.useEffect(() => {
    if (!currentRange || !requestKey) return;
    let cancelled = false;
    void (async () => {
      const res = await listStaffOrderHistoryAction({
        from: currentRange.from,
        to: currentRange.to,
        type,
      });
      if (cancelled) return;
      setResult({
        key: requestKey,
        list: res.success && res.data ? res.data : null,
        error: res.success ? null : res.error ?? "Could not load order history.",
        range: currentRange,
      });
      if (res.success && res.data) {
        // keep only selections that still exist in the refreshed list
        const ids = new Set(res.data.items.map((o) => o.id));
        setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentRange, requestKey, type]);

  const isLoading = requestKey !== null && result?.key !== requestKey;
  const list = result?.list ?? null;
  const appliedRange = result?.range ?? null;
  const listError = currentRange
    ? result?.key === requestKey
      ? result.error
      : null
    : "Please choose a valid date or range.";

  const items: HistoryItem[] = list?.items ?? [];
  // Regular orders and custom cake history records are deletable - for admins only
  const deletableItems = canDelete ? items.filter((i) => i.deletable) : [];
  const allSelected =
    deletableItems.length > 0 && deletableItems.every((o) => selected.has(o.id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDelete = async (ids: string[], method: DeletionMethod, label: string) => {
    setNotice(null);
    setConfirmText("");
    setDialog({ ids, method, label, preview: null, loading: true, error: null });
    // The preview comes from the CURRENT database state, not the cached list
    const res = await previewOrderDeletionAction({ orderIds: ids });
    setDialog((prev) =>
      prev
        ? {
            ...prev,
            loading: false,
            preview: res.success && res.data ? res.data : null,
            error: res.success ? null : res.error ?? "Could not prepare the preview.",
          }
        : prev
    );
  };

  const closeDialog = () => {
    if (isDeleting) return;
    setDialog(null);
    setConfirmText("");
  };

  const previewRows = dialog?.preview?.orders ?? [];
  const ineligibleCount = previewRows.filter((o) => !o.eligible).length;
  const missingCount = dialog?.preview?.missing ?? 0;
  const deleteCount = previewRows.length;
  const needsTyped = deleteCount >= TYPED_CONFIRM_THRESHOLD;
  const canConfirm =
    Boolean(dialog?.preview) &&
    !dialog?.loading &&
    deleteCount > 0 &&
    ineligibleCount === 0 &&
    missingCount === 0 &&
    (!needsTyped || confirmText === "DELETE");

  const confirmDelete = async () => {
    if (!dialog || !canConfirm) return;
    setIsDeleting(true);
    const res = await deleteOrderHistoryAction({
      orderIds: previewRows.map((o) => o.id),
      method: dialog.method,
      rangeLabel: dialog.label.slice(0, 80),
      confirmText: needsTyped ? confirmText : undefined,
    });
    setIsDeleting(false);

    if (!res.success) {
      // Do not claim success; keep the selection and the dialog open
      setDialog((prev) => (prev ? { ...prev, error: res.error ?? "Deletion failed." } : prev));
      return;
    }

    const n = res.data?.deleted ?? 0;
    const warning = res.data?.warning;
    setDialog(null);
    setConfirmText("");
    setSelected(new Set());
    setNotice(
      `${n} ${n === 1 ? "order" : "orders"} deleted successfully.${warning ? ` ${warning}` : ""}`
    );
    setReloadNonce((n) => n + 1);
  };

  const orderSummary = (rows: { order_number: string }[]) => {
    const nums = rows.map((r) => r.order_number);
    if (nums.length <= 6) return nums.join(", ");
    return `${nums.slice(0, 6).join(", ")} and ${nums.length - 6} more`;
  };

  const dialogDates = (() => {
    if (previewRows.length === 0) return null;
    const times = previewRows.map((o) => new Date(o.created_at).getTime());
    const min = new Date(Math.min(...times)).toISOString();
    const max = new Date(Math.max(...times)).toISOString();
    return formatIstDate(min) === formatIstDate(max)
      ? formatIstDate(min)
      : `${formatIstDate(min)} – ${formatIstDate(max)}`;
  })();
  const dialogTotal = previewRows.reduce((sum, o) => sum + o.total_paise, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-xl font-bold text-foreground">Order History</h2>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          Completed, cancelled, rejected and no-show orders and custom cakes, by the date they
          were placed (IST). Active orders are never listed.
          {canDelete
            ? " Regular orders older than 3 months are removed automatically."
            : " This history is read-only."}
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-sm border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Order type">
          {(Object.keys(TYPE_LABELS) as HistoryType[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={type === t}
              onClick={() => {
                setType(t);
                setSelected(new Set());
                setNotice(null);
              }}
              className={`min-h-[44px] px-3 rounded-sm text-xs font-semibold cursor-pointer ${
                type === t
                  ? "bg-cocoa text-cream"
                  : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted/80"
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Date filter">
          {(Object.keys(MODE_LABELS) as RangeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setSelected(new Set());
                setNotice(null);
              }}
              className={`min-h-[44px] px-3 rounded-sm text-xs font-semibold cursor-pointer ${
                mode === m
                  ? "bg-caramel text-white"
                  : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted/80"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
          {mode === "day" && (
            <label className="space-y-1 text-xs font-semibold text-foreground sm:col-span-2">
              Date
              <input type="date" value={dayValue} max={today} onChange={(e) => setDayValue(e.target.value)} className={fieldClass} />
            </label>
          )}
          {mode === "week" && (
            <label className="space-y-1 text-xs font-semibold text-foreground sm:col-span-2">
              Any date in the week (Mon&ndash;Sun)
              <input type="date" value={weekValue} max={today} onChange={(e) => setWeekValue(e.target.value)} className={fieldClass} />
            </label>
          )}
          {mode === "month" && (
            <label className="space-y-1 text-xs font-semibold text-foreground sm:col-span-2">
              Month
              <input type="month" value={monthValue} max={today.slice(0, 7)} onChange={(e) => setMonthValue(e.target.value)} className={fieldClass} />
            </label>
          )}
          {mode === "range" && (
            <>
              <label className="space-y-1 text-xs font-semibold text-foreground">
                From
                <input type="date" value={fromValue} max={today} onChange={(e) => setFromValue(e.target.value)} className={fieldClass} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-foreground">
                To
                <input type="date" value={toValue} max={today} onChange={(e) => setToValue(e.target.value)} className={fieldClass} />
              </label>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" className="flex items-start gap-2.5 rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}
      {listError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">{listError}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {isLoading ? (
            <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Loading&hellip;</span>
          ) : list ? (
            <>
              <strong className="text-foreground">{list.total}</strong>{" "}
              {list.total === 1 ? "record" : "records"}
              {appliedRange ? ` \u00b7 ${appliedRange.label}` : ""}
              {list.total > items.length ? ` \u00b7 showing the latest ${items.length}` : ""}
            </>
          ) : null}
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          {canDelete && selected.size > 0 && (
            <button
              type="button"
              onClick={() =>
                openDelete(
                  deletableItems.filter((o) => selected.has(o.id)).map((o) => o.id),
                  "selected",
                  `${selected.size} selected ${selected.size === 1 ? "order" : "orders"}`
                )
              }
              className="min-h-[44px] px-4 rounded-sm bg-destructive text-white text-xs font-semibold hover:bg-destructive/90 cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              <Trash2 className="size-3.5" />
              <span>Delete Selected ({selected.size})</span>
            </button>
          )}
          {canDelete && deletableItems.length > 0 && appliedRange && (
            <button
              type="button"
              onClick={() => openDelete(deletableItems.map((o) => o.id), mode, appliedRange.label)}
              className="min-h-[44px] px-4 rounded-sm border border-destructive/40 text-destructive text-xs font-semibold hover:bg-destructive/10 cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              <Trash2 className="size-3.5" />
              <span>{BULK_BUTTON_LABELS[mode]} ({deletableItems.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {list && items.length === 0 && !isLoading && (
        <div className="rounded-sm border border-border bg-card p-6 text-center text-xs text-muted-foreground">
          No eligible historical orders found for this period.
        </div>
      )}

      {items.length > 0 && (
        <div className="rounded-sm border border-border bg-card divide-y divide-border">
          {canDelete && deletableItems.length > 0 && (
            <label className="flex min-h-[44px] items-center gap-3 px-3 text-xs font-semibold text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(deletableItems.map((o) => o.id)))
                }
                className="size-4 accent-[var(--color-caramel,#b5651d)]"
              />
              <span>Select all shown ({deletableItems.length})</span>
            </label>
          )}
          {items.map((o) => (
            <div key={`${o.kind}-${o.id}`} className="flex items-center gap-2 px-3 py-1">
              {canDelete && (
                <div className="flex size-11 shrink-0 items-center justify-center">
                  {o.deletable ? (
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      aria-label={`Select ${o.number}`}
                      className="size-4 accent-[var(--color-caramel,#b5651d)]"
                    />
                  ) : null}
                </div>
              )}
              {/* Opens the details ONLY when this record is clicked */}
              <button
                type="button"
                onClick={() => setDetail({ kind: o.kind, id: o.id })}
                aria-label={`View details for ${o.number}`}
                className="min-w-0 flex-1 min-h-[48px] rounded-sm py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel cursor-pointer"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-foreground">{o.number}</span>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide border ${statusBadgeClass(o.status)}`}>
                    {formatOrderStatusLabel(o.status)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Placed {formatIstDate(o.created_at)} &middot; {formatPaise(o.total_paise)}
                </p>
              </button>
              {canDelete && o.deletable && (
                <button
                  type="button"
                  onClick={() => openDelete([o.id], "individual", o.number)}
                  className="min-h-[44px] shrink-0 px-3 rounded-sm border border-destructive/40 text-destructive text-xs font-semibold hover:bg-destructive/10 cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {detail && (
        <HistoryDetailModal
          key={`${detail.kind}-${detail.id}`}
          kind={detail.kind}
          id={detail.id}
          onClose={() => setDetail(null)}
        />
      )}

      {/* Confirmation dialog */}
      {dialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-cocoa/40 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-sm border border-border bg-card p-5 sm:p-6 shadow-md space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h3 id="delete-dialog-title" className="font-heading text-lg font-bold text-foreground break-words">
                  {dialog.loading
                    ? "Preparing deletion…"
                    : deleteCount === 0
                    ? "Nothing to delete"
                    : dialog.method === "individual"
                    ? `Delete order ${previewRows[0].order_number}?`
                    : dialog.method === "selected"
                    ? `Delete ${deleteCount} selected ${deleteCount === 1 ? "order" : "orders"}?`
                    : `Delete orders for ${dialog.label}?`}
                </h3>
                {!dialog.loading && deleteCount > 0 && (
                  <p className="text-xs text-muted-foreground leading-relaxed break-words">
                    {dialog.method === "individual"
                      ? "This will permanently delete this order and its associated order history. This action cannot be undone."
                      : dialog.method === "selected"
                      ? `${orderSummary(previewRows)} will be permanently deleted. This action cannot be undone.`
                      : `${deleteCount} eligible historical ${deleteCount === 1 ? "order" : "orders"} will be permanently deleted. This action cannot be undone.`}
                  </p>
                )}
                {!dialog.loading && deleteCount === 0 && !dialog.error && (
                  <p className="text-xs text-muted-foreground">
                    No eligible historical orders found for this period.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={isDeleting}
                aria-label="Close"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
              >
                <X className="size-5" />
              </button>
            </div>

            {dialog.loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading the current order data&hellip;
              </div>
            )}

            {dialog.error && (
              <div role="alert" className="flex items-start gap-2.5 rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span className="min-w-0 break-words">{dialog.error}</span>
              </div>
            )}

            {(ineligibleCount > 0 || missingCount > 0) && (
              <div role="alert" className="flex items-start gap-2.5 rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>
                  Some selected orders can no longer be deleted (changed or already removed).
                  Close this dialog, refresh and review your selection. Nothing was deleted.
                </span>
              </div>
            )}

            {!dialog.loading && deleteCount > 0 && (
              <div className="space-y-2">
                <div className="rounded-sm border border-border bg-background p-3 text-xs space-y-0.5">
                  <p className="font-semibold uppercase tracking-wider text-[11px] text-muted-foreground">Delete preview</p>
                  <p className="text-foreground">
                    <strong>{deleteCount}</strong> {deleteCount === 1 ? "order" : "orders"}
                    {dialogDates ? ` · ${dialogDates}` : ""} &middot; {formatPaise(dialogTotal)} total
                  </p>
                </div>
                <ul className="max-h-48 overflow-y-auto rounded-sm border border-border divide-y divide-border text-xs">
                  {previewRows.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="min-w-0">
                        <span className="font-mono font-semibold text-foreground">{o.order_number}</span>
                        <span className="text-muted-foreground"> &mdash; {formatOrderStatusLabel(o.status)} &middot; {formatIstDate(o.created_at)}</span>
                      </span>
                      <span className="shrink-0 text-foreground">{formatPaise(o.total_paise)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {needsTyped && !dialog.loading && deleteCount > 0 && (
              <label className="block space-y-1 text-xs font-semibold text-foreground">
                Type DELETE to confirm
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className={fieldClass}
                  placeholder="DELETE"
                />
              </label>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2 border-t border-border/60">
              <button
                type="button"
                onClick={closeDialog}
                disabled={isDeleting}
                className="min-h-[44px] px-4 rounded-sm border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={!canConfirm || isDeleting}
                className="min-h-[44px] px-5 rounded-sm bg-destructive text-white text-xs font-semibold hover:bg-destructive/90 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Deleting&hellip;</span>
                  </>
                ) : (
                  <span>{deleteCount === 1 ? "Delete Order" : `Delete ${deleteCount} Orders`}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
