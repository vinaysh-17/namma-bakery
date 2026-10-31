"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

/** Shift a YYYY-MM-DD calendar date by whole days (timezone independent). */
export function shiftDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d} / ${m} / ${y}`;
}

interface StaffDateNavigatorProps {
  /** e.g. "Order Date:" / "Request Date:" */
  label: string;
  /** Selected date, YYYY-MM-DD (IST) */
  value: string;
  todayIst: string;
  onChange: (date: string) => void;
  /** Accessible noun used in control labels, e.g. "order" / "request" */
  noun: string;
  /** Right-hand description, e.g. "Showing orders created on ..." */
  children: React.ReactNode;
}

/**
 * Shared date header for the Staff Orders Queue and Custom Cake Requests:
 * previous day / date picker / next day / Jump to Today + description text.
 */
export function StaffDateNavigator({
  label,
  value,
  todayIst,
  onChange,
  noun,
  children,
}: StaffDateNavigatorProps) {
  const arrowClass =
    "inline-flex size-9 sm:size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-foreground hover:border-caramel/50 hover:text-caramel transition-colors cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-sm border border-border bg-card">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <button
          type="button"
          onClick={() => onChange(shiftDateString(value, -1))}
          className={arrowClass}
          aria-label={`Previous ${noun} date`}
          title="Previous day"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="relative inline-flex items-center">
          <div className="flex h-9 sm:h-8 items-center gap-2 px-3 rounded-sm border border-border bg-background text-xs font-semibold text-foreground hover:border-caramel/50 transition-colors cursor-pointer shadow-2xs">
            <span>{formatDisplayDate(value)}</span>
            <CalendarDays className="size-3.5 text-caramel shrink-0" />
          </div>
          <input
            type="date"
            value={value}
            onChange={(e) => {
              if (e.target.value) onChange(e.target.value);
            }}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            aria-label={`Select ${noun} date`}
            title={`Click to select ${noun} date`}
          />
        </div>
        <button
          type="button"
          onClick={() => onChange(shiftDateString(value, 1))}
          className={arrowClass}
          aria-label={`Next ${noun} date`}
          title="Next day"
        >
          <ChevronRight className="size-4" />
        </button>
        {value !== todayIst && (
          <button
            type="button"
            onClick={() => onChange(todayIst)}
            className="h-9 sm:h-8 px-2.5 rounded-sm border border-caramel/40 bg-caramel/10 text-caramel hover:bg-caramel/20 text-xs font-semibold transition-colors cursor-pointer"
          >
            Jump to Today
          </button>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{children}</div>
    </div>
  );
}
