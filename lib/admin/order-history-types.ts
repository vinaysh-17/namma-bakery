/**
 * Admin order history (deletion + retention): client-safe types and date-range helpers.
 *
 * History filtering uses orders.created_at (the date the order was placed - the same date
 * the staff queue groups by). Ranges are computed in IST (Asia/Kolkata, UTC+05:30, no DST)
 * and sent to the database as absolute timestamps, never as formatted display strings.
 */

export const HISTORY_STATUSES = ["COMPLETED", "REJECTED", "CANCELLED", "NO_SHOW"] as const;

export type DeletionMethod = "individual" | "selected" | "day" | "week" | "month" | "range";

/** Deleting this many orders or more requires typing DELETE (also enforced server side). */
export const TYPED_CONFIRM_THRESHOLD = 5;

export interface HistoryOrderRow {
  id: string;
  order_number: string;
  status: string;
  created_at: string;
  total_paise: number;
  payment_status: string;
}

export interface OrderHistoryList {
  orders: HistoryOrderRow[];
  /** Eligible orders matching the range (can exceed orders.length when truncated) */
  total: number;
  /** Terminal orders left out because they come from a custom cake request */
  excluded_custom: number;
}

export interface DeletionPreviewRow extends HistoryOrderRow {
  eligible: boolean;
  /** "normal" = regular order (NB...), "custom" = custom cake history record (CC...) */
  kind?: "normal" | "custom";
}

export interface DeletionPreview {
  orders: DeletionPreviewRow[];
  missing: number;
}

export interface HistoryRange {
  /** inclusive lower bound (ISO timestamp) */
  from: string;
  /** exclusive upper bound (ISO timestamp) */
  to: string;
  label: string;
}

const IST_OFFSET = "+05:30";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

function parseYmd(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const p = parseYmd(dateStr);
  if (!p) return dateStr;
  return toYmd(new Date(Date.UTC(p.y, p.m - 1, p.d + days)));
}

function istStart(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00${IST_OFFSET}`).toISOString();
}

function longDate(dateStr: string): string {
  const p = parseYmd(dateStr)!;
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

function shortDate(dateStr: string): string {
  const p = parseYmd(dateStr)!;
  return `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`;
}

/** Day: value = YYYY-MM-DD. */
export function dayRange(value: string): HistoryRange | null {
  if (!parseYmd(value)) return null;
  return { from: istStart(value), to: istStart(addDays(value, 1)), label: longDate(value) };
}

/** Week (Monday - Sunday) containing the given YYYY-MM-DD. */
export function weekRange(value: string): HistoryRange | null {
  const p = parseYmd(value);
  if (!p) return null;
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
  const monday = addDays(value, -((dow + 6) % 7));
  const sunday = addDays(monday, 6);
  return {
    from: istStart(monday),
    to: istStart(addDays(sunday, 1)),
    label: `${shortDate(monday)} – ${shortDate(sunday)}`,
  };
}

/** Month: value = YYYY-MM. */
export function monthRange(value: string): HistoryRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  const first = `${match[1]}-${match[2]}-01`;
  const next = toYmd(new Date(Date.UTC(y, m, 1)));
  return { from: istStart(first), to: istStart(next), label: `${MONTHS[m - 1]} ${y}` };
}

/** Custom range: both dates inclusive (YYYY-MM-DD). */
export function customRange(fromDate: string, toDate: string): HistoryRange | null {
  if (!parseYmd(fromDate) || !parseYmd(toDate) || fromDate > toDate) return null;
  return {
    from: istStart(fromDate),
    to: istStart(addDays(toDate, 1)),
    label: `${shortDate(fromDate)} – ${shortDate(toDate)}`,
  };
}

/** Order type filter for the history views (admin + staff). */
export type HistoryType = "all" | "normal" | "custom";

/**
 * One row of the unified history list.
 * - normal: a terminal order (NB...), `id` is the order id.
 * - custom: a custom cake history record (CC...), `id` is the REQUEST id. When a linked
 *   order (NB...) exists it is shown on the record, never as a second row.
 */
export interface HistoryItem {
  kind: "normal" | "custom";
  id: string;
  number: string;
  /** Order-style status (linked order status for custom cakes that have an order) */
  status: string;
  created_at: string;
  total_paise: number;
  payment_status: string;
  request_status: string | null;
  linked_order_number: string | null;
  linked_order_id: string | null;
  /** Deletable by an admin (regular orders and custom cake history records); never by staff */
  deletable: boolean;
}

export interface HistoryItemList {
  items: HistoryItem[];
  total: number;
}
