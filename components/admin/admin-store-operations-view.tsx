"use client";

import * as React from "react";
import {
  Store,
  Clock,
  Calendar,
  RotateCcw,
  Plus,
  Trash2,
  AlertCircle,
  Sliders,
  Pencil,
  Archive,
  AlertTriangle,
  X,
} from "lucide-react";
import type {
  LocationInfo,
  StoreSettings,
  SpecialClosure,
  BusinessHour,
} from "@/lib/admin/types";
import {
  updateStoreSettingsAction,
  toggleStorePauseAction,
  addSpecialClosureAction,
  removeSpecialClosureAction,
  updateSpecialClosureAction,
  updateBusinessHourAction,
  archiveBusinessHourAction,
  unarchiveBusinessHourAction,
} from "@/lib/admin/actions";
import { formatIstDateTime, formatIstDate } from "@/lib/utils/date";

interface AdminStoreOperationsViewProps {
  location: LocationInfo | null;
  settings: StoreSettings | null;
  closures: SpecialClosure[];
  hours: BusinessHour[];
  isStorePaused?: boolean;
  onActionSuccess: () => void;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatClosureDisplay(dateStr: string): string {
  try {
    const d = new Date(`${dateStr}T12:00:00+05:30`);
    return formatIstDate(d, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function AdminStoreOperationsView({
  location,
  settings,
  closures,
  hours,
  isStorePaused = false,
  onActionSuccess,
}: AdminStoreOperationsViewProps) {
  // Store Pause State derived from server summary
  const isCurrentlyPaused = isStorePaused;

  const [pauseDurationHours, setPauseDurationHours] = React.useState("4");
  const [pauseMessage, setPauseMessage] = React.useState(
    settings?.pause_message || "Online ordering is temporarily paused due to heavy in-store rush."
  );
  const [isTogglingPause, setIsTogglingPause] = React.useState(false);
  const [pauseError, setPauseError] = React.useState<string | null>(null);

  // Slot settings state
  const [slotMinutes, setSlotMinutes] = React.useState<15 | 30 | 60>(
    settings?.slot_minutes || 30
  );
  const [maxOrdersPerSlot, setMaxOrdersPerSlot] = React.useState(
    settings?.max_orders_per_slot?.toString() || "6"
  );
  const [maxCustomPerDay, setMaxCustomPerDay] = React.useState(
    settings?.max_custom_per_day?.toString() || "4"
  );
  const [cancelCutoffHours, setCancelCutoffHours] = React.useState(
    settings?.cancel_cutoff_hours?.toString() || "4"
  );
  const [pendingAlertMinutes, setPendingAlertMinutes] = React.useState(
    settings?.pending_alert_minutes?.toString() || "15"
  );
  const [isSavingSettings, setIsSavingSettings] = React.useState(false);
  const [settingsFeedback, setSettingsFeedback] = React.useState<string | null>(null);

  // Track last known hours for each weekday to restore on unarchive
  const lastKnownHoursRef = React.useRef<Record<number, { opens: string; closes: string }>>({});
  React.useEffect(() => {
    hours.forEach((h) => {
      lastKnownHoursRef.current[h.weekday] = { opens: h.opens, closes: h.closes };
    });
  }, [hours]);

  // Special Closure Add state
  const [newClosureDate, setNewClosureDate] = React.useState("");
  const [newClosureReason, setNewClosureReason] = React.useState("");
  const [isAddingClosure, setIsAddingClosure] = React.useState(false);
  const [closureError, setClosureError] = React.useState<string | null>(null);

  // Special Closure Edit state
  const [editingClosure, setEditingClosure] = React.useState<SpecialClosure | null>(null);
  const [editClosureDate, setEditClosureDate] = React.useState("");
  const [editClosureReason, setEditClosureReason] = React.useState("");
  const [isUpdatingClosure, setIsUpdatingClosure] = React.useState(false);
  const [editClosureError, setEditClosureError] = React.useState<string | null>(null);

  // Special Closure Delete Confirmation state
  const [deletingClosure, setDeletingClosure] = React.useState<SpecialClosure | null>(null);
  const [isDeletingClosure, setIsDeletingClosure] = React.useState(false);
  const [deleteClosureError, setDeleteClosureError] = React.useState<string | null>(null);

  // Business Hours Edit state
  const [editingHour, setEditingHour] = React.useState<{
    weekday: number;
    dayName: string;
    hourId?: string;
    opens: string;
    closes: string;
  } | null>(null);
  const [editOpens, setEditOpens] = React.useState("10:00");
  const [editCloses, setEditCloses] = React.useState("21:30");
  const [isSavingHours, setIsSavingHours] = React.useState(false);
  const [hoursModalError, setHoursModalError] = React.useState<string | null>(null);

  // Business Hours Archive Confirmation state
  const [archivingHour, setArchivingHour] = React.useState<{
    weekday: number;
    dayName: string;
    hourId: string;
  } | null>(null);
  const [isArchivingHour, setIsArchivingHour] = React.useState(false);
  const [archiveHourError, setArchiveHourError] = React.useState<string | null>(null);

  // Business Hours Unarchive Confirmation state
  const [unarchivingHour, setUnarchivingHour] = React.useState<{
    weekday: number;
    dayName: string;
  } | null>(null);
  const [isUnarchivingHour, setIsUnarchivingHour] = React.useState(false);
  const [unarchiveHourError, setUnarchiveHourError] = React.useState<string | null>(null);

  const handleTogglePause = async (pause: boolean) => {
    if (!location) return;
    setIsTogglingPause(true);
    setPauseError(null);

    let paused_until: string | null = null;
    if (pause) {
      const hoursNum = parseInt(pauseDurationHours, 10) || 4;
      paused_until = new Date(Date.now() + hoursNum * 3600 * 1000).toISOString();
    }

    const res = await toggleStorePauseAction({
      location_id: location.id,
      is_paused: pause,
      paused_until,
      pause_message: pause ? pauseMessage : null,
    });
    setIsTogglingPause(false);

    if (!res.success) {
      setPauseError(res.error || "Failed to update store pause state.");
      return;
    }

    onActionSuccess();
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) return;

    setIsSavingSettings(true);
    setSettingsFeedback(null);

    const res = await updateStoreSettingsAction({
      location_id: location.id,
      slot_minutes: slotMinutes,
      max_orders_per_slot: parseInt(maxOrdersPerSlot, 10) || 6,
      max_custom_per_day: parseInt(maxCustomPerDay, 10) || 4,
      quote_validity_hours: settings?.quote_validity_hours ?? 24,
      cancel_cutoff_hours: parseInt(cancelCutoffHours, 10) || 4,
      pending_alert_minutes: parseInt(pendingAlertMinutes, 10) || 15,
    });
    setIsSavingSettings(false);

    if (!res.success) {
      setSettingsFeedback(res.error || "Failed to save settings.");
      return;
    }

    setSettingsFeedback("Settings saved successfully.");
    setTimeout(() => setSettingsFeedback(null), 3000);
    onActionSuccess();
  };

  const handleAddClosure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location || !newClosureDate) return;

    setIsAddingClosure(true);
    setClosureError(null);

    const res = await addSpecialClosureAction({
      location_id: location.id,
      closure_date: newClosureDate,
      reason: newClosureReason.trim() || "Scheduled bakery closure",
    });
    setIsAddingClosure(false);

    if (!res.success) {
      setClosureError(res.error || "Failed to add closure date.");
      return;
    }

    setNewClosureDate("");
    setNewClosureReason("");
    onActionSuccess();
  };

  const handleOpenEditClosure = (c: SpecialClosure) => {
    setEditingClosure(c);
    setEditClosureDate(c.closure_date);
    setEditClosureReason(c.reason || "");
    setEditClosureError(null);
  };

  const handleUpdateClosure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClosure || !location) return;

    setIsUpdatingClosure(true);
    setEditClosureError(null);

    const res = await updateSpecialClosureAction({
      id: editingClosure.id,
      location_id: location.id,
      closure_date: editClosureDate,
      reason: editClosureReason.trim() || "Scheduled bakery closure",
    });

    setIsUpdatingClosure(false);

    if (!res.success) {
      setEditClosureError(res.error || "Failed to update closure.");
      return;
    }

    setEditingClosure(null);
    onActionSuccess();
  };

  const handleConfirmDeleteClosure = async () => {
    if (!deletingClosure) return;

    setIsDeletingClosure(true);
    setDeleteClosureError(null);

    const res = await removeSpecialClosureAction(deletingClosure.id);
    setIsDeletingClosure(false);

    if (!res.success) {
      setDeleteClosureError(res.error || "Failed to delete closure.");
      return;
    }

    setDeletingClosure(null);
    onActionSuccess();
  };

  const handleOpenEditHours = (
    weekdayIndex: number,
    dayName: string,
    existingHour?: BusinessHour
  ) => {
    setEditingHour({
      weekday: weekdayIndex,
      dayName,
      hourId: existingHour?.id,
      opens: existingHour ? existingHour.opens.slice(0, 5) : "10:00",
      closes: existingHour ? existingHour.closes.slice(0, 5) : "21:30",
    });
    setEditOpens(existingHour ? existingHour.opens.slice(0, 5) : "10:00");
    setEditCloses(existingHour ? existingHour.closes.slice(0, 5) : "21:30");
    setHoursModalError(null);
  };

  const handleSaveHours = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHour || !location) return;

    if (editOpens >= editCloses) {
      setHoursModalError("Opening time must be earlier than closing time.");
      return;
    }

    setIsSavingHours(true);
    setHoursModalError(null);

    const res = await updateBusinessHourAction({
      id: editingHour.hourId,
      location_id: location.id,
      weekday: editingHour.weekday,
      opens: editOpens,
      closes: editCloses,
    });

    setIsSavingHours(false);

    if (!res.success) {
      setHoursModalError(res.error || "Failed to save operating hours.");
      return;
    }

    setEditingHour(null);
    onActionSuccess();
  };

  const handleConfirmArchiveHours = async () => {
    if (!archivingHour) return;

    setIsArchivingHour(true);
    setArchiveHourError(null);

    const res = await archiveBusinessHourAction(archivingHour.hourId);
    setIsArchivingHour(false);

    if (!res.success) {
      setArchiveHourError(res.error || "Failed to archive operating hours.");
      return;
    }

    setArchivingHour(null);
    onActionSuccess();
  };

  const handleConfirmUnarchiveHours = async () => {
    if (!unarchivingHour || !location) return;

    setIsUnarchivingHour(true);
    setUnarchiveHourError(null);

    const lastKnown = lastKnownHoursRef.current[unarchivingHour.weekday];
    const res = await unarchiveBusinessHourAction({
      location_id: location.id,
      weekday: unarchivingHour.weekday,
      opens: lastKnown?.opens,
      closes: lastKnown?.closes,
    });
    setIsUnarchivingHour(false);

    if (!res.success) {
      setUnarchiveHourError(res.error || "Failed to unarchive operating hours.");
      return;
    }

    setUnarchivingHour(null);
    onActionSuccess();
  };

  return (
    <div className="space-y-6">
      {/* Top Title */}
      <div>
        <h2 className="font-heading text-lg font-bold text-foreground">
          Store Operations & Scheduling
        </h2>
        <p className="text-xs text-muted-foreground">
          Control live order intake, slot capacities, lead time limits, and scheduled holiday closures.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Live Pause Controls */}
        <div className="rounded-sm border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Store className="size-4 text-caramel" />
            <h3 className="font-heading font-bold text-sm text-foreground">
              Online Ordering Intake
            </h3>
          </div>

          <div
            className={`p-3.5 rounded-sm border ${
              isCurrentlyPaused
                ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
                : "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`size-2.5 rounded-full ${
                    isCurrentlyPaused ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                />
                <span className="font-bold text-xs uppercase tracking-wider">
                  {isCurrentlyPaused ? "Store Paused" : "Accepting Orders"}
                </span>
              </div>
              {isCurrentlyPaused && settings?.orders_paused_until && (
                <span className="text-[11px] font-mono">
                  Paused until {formatIstDateTime(settings.orders_paused_until)}
                </span>
              )}
            </div>
            {settings?.pause_message && (
              <p className="text-xs mt-2 italic">&ldquo;{settings.pause_message}&rdquo;</p>
            )}
          </div>

          {pauseError && (
            <div className="flex items-center gap-2 p-2 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>{pauseError}</span>
            </div>
          )}

          {isCurrentlyPaused ? (
            <div className="space-y-3 pt-2">
              <p className="text-xs text-muted-foreground">
                Online order intake is currently blocked for customers. Resuming will immediately open available pickup slots on the storefront.
              </p>
              <button
                type="button"
                disabled={isTogglingPause}
                onClick={() => handleTogglePause(false)}
                className="w-full h-9 rounded-sm bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isTogglingPause && <RotateCcw className="size-3.5 animate-spin" />}
                <span>Resume Store Orders Now</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 pt-2 text-xs">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Pause Duration
                </label>
                <select
                  value={pauseDurationHours}
                  onChange={(e) => setPauseDurationHours(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                >
                  <option value="1">1 Hour</option>
                  <option value="2">2 Hours</option>
                  <option value="4">4 Hours (Kitchen Rush)</option>
                  <option value="8">8 Hours (End of shift)</option>
                  <option value="24">24 Hours (Full day)</option>
                  <option value="48">48 Hours (2 days)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Customer Banner Message
                </label>
                <input
                  type="text"
                  value={pauseMessage}
                  onChange={(e) => setPauseMessage(e.target.value)}
                  placeholder="Reason displayed on checkout/menu..."
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <button
                type="button"
                disabled={isTogglingPause}
                onClick={() => handleTogglePause(true)}
                className="w-full h-9 rounded-sm bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isTogglingPause && <RotateCcw className="size-3.5 animate-spin" />}
                <span>Pause Online Orders</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Slot Capacity & Limits */}
        <div className="rounded-sm border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sliders className="size-4 text-caramel" />
            <h3 className="font-heading font-bold text-sm text-foreground">
              Slot Capacities & Timing
            </h3>
          </div>

          {settingsFeedback && (
            <div className="p-2 rounded text-xs bg-emerald-100 text-emerald-900 border border-emerald-200">
              {settingsFeedback}
            </div>
          )}

          <form onSubmit={handleSaveSettings} className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Slot Interval
                </label>
                <select
                  value={slotMinutes}
                  onChange={(e) =>
                    setSlotMinutes(parseInt(e.target.value, 10) as 15 | 30 | 60)
                  }
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                >
                  <option value={15}>15 Minutes</option>
                  <option value={30}>30 Minutes (Recommended)</option>
                  <option value={60}>60 Minutes</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Max Orders / Slot
                </label>
                <input
                  type="number"
                  min={0}
                  value={maxOrdersPerSlot}
                  onChange={(e) => setMaxOrdersPerSlot(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Max Custom Cakes / Day
                </label>
                <input
                  type="number"
                  min={0}
                  value={maxCustomPerDay}
                  onChange={(e) => setMaxCustomPerDay(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Cancellation Cutoff (Hrs)
                </label>
                <input
                  type="number"
                  min={0}
                  value={cancelCutoffHours}
                  onChange={(e) => setCancelCutoffHours(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Kitchen Alert (Mins)
                </label>
                <input
                  type="number"
                  min={1}
                  value={pendingAlertMinutes}
                  onChange={(e) => setPendingAlertMinutes(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSavingSettings}
              className="w-full h-9 rounded-sm bg-caramel text-white font-semibold hover:bg-caramel/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
            >
              {isSavingSettings && <RotateCcw className="size-3.5 animate-spin" />}
              <span>Save Slot Settings</span>
            </button>
          </form>
        </div>
      </div>

      {/* Special Closures & Regular Hours Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Special Closures Table & Add */}
        <div className="rounded-sm border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-caramel" />
            <h3 className="font-heading font-bold text-sm text-foreground">
              Scheduled Holiday Closures
            </h3>
          </div>

          {closureError && (
            <div className="p-2 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
              {closureError}
            </div>
          )}

          {/* Add closure form */}
          <form onSubmit={handleAddClosure} className="flex flex-col sm:flex-row gap-2 text-xs">
            <input
              type="date"
              required
              aria-label="Closure Date"
              value={newClosureDate}
              onChange={(e) => setNewClosureDate(e.target.value)}
              className="h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
            />
            <input
              type="text"
              aria-label="Closure Reason"
              value={newClosureReason}
              onChange={(e) => setNewClosureReason(e.target.value)}
              placeholder="e.g. Ayudha Pooja, Bakery maintenance"
              className="flex-1 h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
            />
            <button
              type="submit"
              disabled={isAddingClosure || !newClosureDate}
              title={
                !newClosureDate
                  ? "Select a date to schedule a closure"
                  : "Add scheduled holiday closure"
              }
              className="h-8 px-3.5 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap shadow-2xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-caramel disabled:shadow-none"
            >
              {isAddingClosure ? (
                <RotateCcw className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              <span>Add</span>
            </button>
          </form>

          {/* Closures table */}
          <div className="rounded-sm border border-border overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[340px]">
              <thead className="bg-muted/40 border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-2 px-3 font-semibold">Date</th>
                  <th className="py-2 px-3 font-semibold">Reason</th>
                  <th className="py-2 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {closures.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-muted-foreground">
                      No special closures scheduled.
                    </td>
                  </tr>
                ) : (
                  closures.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20">
                      <td className="py-2 px-3 font-mono font-bold text-foreground whitespace-nowrap">
                        {c.closure_date}
                      </td>
                      <td className="py-2 px-3 text-foreground">{c.reason || "Closed"}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditClosure(c)}
                            className="h-7 px-2 rounded-xs border border-border bg-background text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                            title="Edit holiday closure"
                          >
                            <Pencil className="size-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingClosure(c);
                              setDeleteClosureError(null);
                            }}
                            className="h-7 px-2 rounded-xs border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/15 transition-colors inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                            title="Delete holiday closure"
                          >
                            <Trash2 className="size-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Regular Operating Hours */}
        <div className="rounded-sm border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-caramel" />
            <h3 className="font-heading font-bold text-sm text-foreground">
              Standard Weekly Operating Hours
            </h3>
          </div>

          <div className="rounded-sm border border-border overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[380px]">
              <thead className="bg-muted/40 border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-2 px-3 font-semibold">Day of Week</th>
                  <th className="py-2 px-3 font-semibold">Opening Time</th>
                  <th className="py-2 px-3 font-semibold">Closing Time</th>
                  <th className="py-2 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {WEEKDAYS.map((dayName, weekdayIndex) => {
                  const h = hours.find((item) => item.weekday === weekdayIndex);
                  return (
                    <tr key={weekdayIndex} className="hover:bg-muted/20">
                      <td className="py-2 px-3 font-semibold text-foreground whitespace-nowrap">
                        {dayName}
                      </td>
                      <td className="py-2 px-3 font-mono text-muted-foreground whitespace-nowrap">
                        {h ? (
                          h.opens.slice(0, 5)
                        ) : (
                          <span className="italic text-muted-foreground">Closed</span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono text-muted-foreground whitespace-nowrap">
                        {h ? (
                          h.closes.slice(0, 5)
                        ) : (
                          <span className="italic text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditHours(weekdayIndex, dayName, h)}
                            className="h-7 px-2 rounded-xs border border-border bg-background text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                            title={`Edit ${dayName} operating hours`}
                          >
                            <Pencil className="size-3" />
                            <span>Edit</span>
                          </button>
                          {h ? (
                            <button
                              type="button"
                              onClick={() => {
                                setArchivingHour({
                                  weekday: weekdayIndex,
                                  dayName,
                                  hourId: h.id,
                                });
                                setArchiveHourError(null);
                              }}
                              className="h-7 px-2 rounded-xs border border-amber-300/80 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 transition-colors inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                              title={`Archive ${dayName} operating hours`}
                            >
                              <Archive className="size-3" />
                              <span>Archive</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setUnarchivingHour({
                                  weekday: weekdayIndex,
                                  dayName,
                                });
                                setUnarchiveHourError(null);
                              }}
                              className="h-7 px-2 rounded-xs border border-emerald-300/80 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200 transition-colors inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                              title={`Unarchive ${dayName} operating hours`}
                            >
                              <RotateCcw className="size-3" />
                              <span>Unarchive</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Holiday Closure Modal */}
      {editingClosure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-sm border border-border bg-card p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-heading font-bold text-base text-foreground">
                  Edit Holiday Closure
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Update the scheduled date and closure reason.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingClosure(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {editClosureError && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{editClosureError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateClosure} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Closure Date <span className="text-destructive">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={editClosureDate}
                  onChange={(e) => setEditClosureDate(e.target.value)}
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Reason for Closure
                </label>
                <input
                  type="text"
                  value={editClosureReason}
                  onChange={(e) => setEditClosureReason(e.target.value)}
                  placeholder="e.g. Ayudha Pooja, Bakery maintenance"
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditingClosure(null)}
                  className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingClosure || !editClosureDate}
                  className="h-9 px-4 rounded-sm bg-caramel text-white font-semibold hover:bg-caramel/90 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isUpdatingClosure && <RotateCcw className="size-3.5 animate-spin" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Holiday Closure Confirmation Modal */}
      {deletingClosure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-sm border border-border bg-card p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                <AlertTriangle className="size-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-heading font-bold text-base text-foreground">
                  Delete Holiday Closure?
                </h3>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  Are you sure you want to remove the scheduled closure for{" "}
                  <strong className="text-foreground">
                    {formatClosureDisplay(deletingClosure.closure_date)}
                  </strong>
                  ?
                </p>
                {deletingClosure.reason && (
                  <p className="text-xs text-muted-foreground mt-1 italic">
                    Reason: &ldquo;{deletingClosure.reason}&rdquo;
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  Removing this will immediately reopen customer pickup slots for this date on the storefront.
                </p>
              </div>
            </div>

            {deleteClosureError && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{deleteClosureError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setDeletingClosure(null)}
                className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingClosure}
                onClick={handleConfirmDeleteClosure}
                className="h-9 px-4 rounded-sm bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isDeletingClosure && <RotateCcw className="size-3.5 animate-spin" />}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Operating Hours Modal */}
      {editingHour && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-sm border border-border bg-card p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-heading font-bold text-base text-foreground">
                  Edit Operating Hours — {editingHour.dayName}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set store opening and closing times for {editingHour.dayName}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingHour(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {hoursModalError && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{hoursModalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveHours} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Opening Time <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="time"
                    required
                    value={editOpens}
                    onChange={(e) => setEditOpens(e.target.value)}
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Closing Time <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="time"
                    required
                    value={editCloses}
                    onChange={(e) => setEditCloses(e.target.value)}
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditingHour(null)}
                  className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingHours}
                  className="h-9 px-4 rounded-sm bg-caramel text-white font-semibold hover:bg-caramel/90 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSavingHours && <RotateCcw className="size-3.5 animate-spin" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive Operating Hours Confirmation Modal */}
      {archivingHour && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-sm border border-border bg-card p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 flex items-center justify-center shrink-0">
                <AlertTriangle className="size-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-heading font-bold text-base text-foreground">
                  Archive Operating Hours?
                </h3>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  Are you sure you want to archive{" "}
                  <strong className="text-foreground">{archivingHour.dayName}&apos;s</strong>{" "}
                  operating hours?
                </p>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  The operating-hours configuration for this day will be deactivated and marked as closed. Customer ordering and pickup slot reservations for {archivingHour.dayName}s will be disabled until hours are re-configured. Historical audit records remain preserved.
                </p>
              </div>
            </div>

            {archiveHourError && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{archiveHourError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setArchivingHour(null)}
                className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isArchivingHour}
                onClick={handleConfirmArchiveHours}
                className="h-9 px-4 rounded-sm bg-amber-700 text-white font-semibold hover:bg-amber-800 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isArchivingHour && <RotateCcw className="size-3.5 animate-spin" />}
                <span>Archive</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unarchive Operating Hours Confirmation Modal */}
      {unarchivingHour && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-sm border border-border bg-card p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center shrink-0">
                <RotateCcw className="size-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-heading font-bold text-base text-foreground">
                  Unarchive Operating Hours?
                </h3>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  Are you sure you want to unarchive{" "}
                  <strong className="text-foreground">{unarchivingHour.dayName}&apos;s</strong>{" "}
                  operating hours?
                </p>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  This will restore {unarchivingHour.dayName}&apos;s operating hours and reactivate pickup slot scheduling for this day on the storefront.
                </p>
              </div>
            </div>

            {unarchiveHourError && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{unarchiveHourError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setUnarchivingHour(null)}
                className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUnarchivingHour}
                onClick={handleConfirmUnarchiveHours}
                className="h-9 px-4 rounded-sm bg-emerald-700 text-white font-semibold hover:bg-emerald-800 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isUnarchivingHour && <RotateCcw className="size-3.5 animate-spin" />}
                <span>Unarchive</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
