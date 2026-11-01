"use client";

import * as React from "react";
import {
  X,
  Phone,
  Mail,
  Calendar,
  Clock,
  Sparkles,
  Send,
  Loader2,
  ExternalLink,
  Image as ImageIcon,
} from "lucide-react";
import type { CustomCakeRequest } from "@/lib/custom-cake/types";
import type { StaffOrder } from "@/lib/staff/types";
import type { CustomCakeModalType } from "./staff-custom-cake-modal";
import type { ModalType } from "./staff-status-modal";
import {
  getStaffStatusBadgeClass,
  type CustomCakeStaffStatus,
} from "@/lib/staff/custom-cake-workflow";
import {
  formatOrderStatusLabel,
  PAYMENT_RECEIVED_HANDOVER_LABEL,
} from "@/lib/staff/formatters";
import { formatPaise } from "@/lib/utils/money";
import {
  addCustomCakeStaffNoteAction,
  getCustomCakeSignedUrlAction,
} from "@/lib/custom-cake/staff-actions";
import { formatIstDate, formatIstTime, formatIstDateTime } from "@/lib/utils/date";

interface StaffCustomCakeDetailProps {
  request: CustomCakeRequest;
  /** Order-style staff status derived from the request / its linked order */
  staffStatus: CustomCakeStaffStatus;
  /** The order created when staff accepted this request (if any) */
  linkedOrder?: StaffOrder | null;
  onClose: () => void;
  /** Pending-stage dialogs (accept / reject request) */
  onOpenModal: (modal: CustomCakeModalType) => void;
  /** Order-stage dialogs (ready, collect payment & handover, cancel) on the linked order */
  onOpenOrderModal: (modal: ModalType) => void;
  /** Changes each time staff click "Photo Attached" on this request's card */
  photoFocusNonce?: number;
  /** Order History: no operations and no note form (view only) */
  readOnly?: boolean;
}

/**
 * Page-session cache for reference photos, keyed by storage path (unique per request).
 * Successfully loaded signed URLs are kept so collapsing/expanding the details or
 * switching between requests never re-fetches an image that is already loaded.
 * Nothing is preloaded: a path is only requested when its photo is actually shown.
 * Failures are remembered too, so reopening the details does not retry repeatedly;
 * the Retry button clears the entry and fetches again.
 */
const signedUrlCache = new Map<string, string>();
const failedPaths = new Set<string>();
const inFlightLoads = new Map<string, Promise<string | null>>();

function loadReferenceUrl(storagePath: string): Promise<string | null> {
  const cached = signedUrlCache.get(storagePath);
  if (cached) return Promise.resolve(cached);
  if (failedPaths.has(storagePath)) return Promise.resolve(null);

  const pending = inFlightLoads.get(storagePath);
  if (pending) return pending;

  const load = getCustomCakeSignedUrlAction(storagePath)
    .then((res) => {
      if (res.success && res.signedUrl) {
        signedUrlCache.set(storagePath, res.signedUrl);
        return res.signedUrl;
      }
      failedPaths.add(storagePath);
      return null;
    })
    .catch(() => {
      failedPaths.add(storagePath);
      return null;
    })
    .finally(() => {
      inFlightLoads.delete(storagePath);
    });
  inFlightLoads.set(storagePath, load);
  return load;
}

type ReferenceImageState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error" };

/**
 * One customer reference photo. The bucket is private, so the image is fetched through a
 * short-lived signed URL issued only to authorised staff/admin (verified server-side).
 */
function ReferenceImage({ storagePath }: { storagePath: string }) {
  const [state, setState] = React.useState<ReferenceImageState>(() => {
    const cached = signedUrlCache.get(storagePath);
    if (cached) return { status: "ready", url: cached };
    if (failedPaths.has(storagePath)) return { status: "error" };
    return { status: "loading" };
  });

  React.useEffect(() => {
    if (state.status !== "loading") return;
    let isMounted = true;
    loadReferenceUrl(storagePath).then((url) => {
      if (isMounted) {
        setState(url ? { status: "ready", url } : { status: "error" });
      }
    });
    return () => {
      isMounted = false;
    };
  }, [storagePath, state.status]);

  const retry = () => {
    signedUrlCache.delete(storagePath);
    failedPaths.delete(storagePath);
    setState({ status: "loading" });
  };

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading reference image...</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="italic">Reference image is unavailable.</span>
        <button
          type="button"
          onClick={retry}
          className="font-semibold text-caramel hover:underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <a href={state.url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={state.url}
          alt="Customer cake reference"
          onError={() => {
            // Likely an expired signed URL: drop it and show the retry state once
            signedUrlCache.delete(storagePath);
            failedPaths.add(storagePath);
            setState({ status: "error" });
          }}
          className="max-h-56 w-auto object-contain rounded-xs border border-border mx-auto"
        />
      </a>
      <a
        href={state.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-caramel hover:underline"
      >
        <ExternalLink className="size-3.5" />
        <span>View High-Resolution Image</span>
      </a>
    </div>
  );
}

export function StaffCustomCakeDetail({
  request,
  staffStatus,
  linkedOrder,
  onClose,
  onOpenModal,
  onOpenOrderModal,
  photoFocusNonce = 0,
  readOnly = false,
}: StaffCustomCakeDetailProps) {
  const [internalNoteInput, setInternalNoteInput] = React.useState("");
  const [isAddingNote, setIsAddingNote] = React.useState(false);
  const [noteError, setNoteError] = React.useState<string | null>(null);
  const [isExpanded, setIsExpanded] = React.useState(readOnly);
  const photoSectionRef = React.useRef<HTMLDivElement>(null);
  // Bumped whenever the reference photo should be scrolled into view
  const [photoScrollTick, setPhotoScrollTick] = React.useState(0);
  const [handledPhotoNonce, setHandledPhotoNonce] = React.useState(0);

  // "Photo Attached" was clicked on the card: make sure the details are open, then scroll
  // to the photo (adjusted during render, keyed on the nonce, so it works whether the
  // panel was already open or is being mounted by this very click).
  if (photoFocusNonce !== 0 && photoFocusNonce !== handledPhotoNonce) {
    setHandledPhotoNonce(photoFocusNonce);
    setIsExpanded(true);
    setPhotoScrollTick((t) => t + 1);
  }

  React.useEffect(() => {
    if (photoScrollTick === 0) return;
    photoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [photoScrollTick]);

  const showReferencePhoto = () => {
    setIsExpanded(true);
    setPhotoScrollTick((t) => t + 1);
  };

  const referenceImages = request.custom_cake_images ?? [];

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!internalNoteInput.trim()) return;

    setNoteError(null);
    setIsAddingNote(true);

    try {
      const res = await addCustomCakeStaffNoteAction({
        requestId: request.id,
        body: internalNoteInput.trim(),
      });

      if (!res.success) {
        setNoteError(res.error || "Failed to add note.");
      } else {
        setInternalNoteInput("");
      }
    } catch (err) {
      console.error("[StaffCustomCakeDetail] Error adding note:", err);
      setNoteError("Failed to save note.");
    } finally {
      setIsAddingNote(false);
    }
  };

  return (
    <div className="flex flex-col bg-card">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-border flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-mono text-lg sm:text-xl font-bold tracking-tight text-foreground">
              {request.request_number}
            </h2>
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold tracking-wide border ${getStaffStatusBadgeClass(
                staffStatus
              )}`}
            >
              {formatOrderStatusLabel(staffStatus)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            Submitted on {formatIstDateTime(request.created_at)}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel"
          title="Close details"
          aria-label="Close details"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Main Content */}
      <div className="p-4 sm:p-5 space-y-6">
        {/* Next Operations Bar - same lifecycle as the Orders Queue */}
        <div className="rounded-sm border border-border bg-background p-3.5 space-y-2">
          {!readOnly && (
            <>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
            Available Operations
          </span>
          <div className="flex flex-wrap gap-2">
            {staffStatus === "PENDING" && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenModal({ type: "ACCEPT", request, staffStatus })}
                  className="h-9 px-3 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 cursor-pointer"
                >
                  Accept & Schedule
                </button>
                <button
                  type="button"
                  onClick={() => onOpenModal({ type: "REJECT", request, staffStatus })}
                  className="h-9 px-3 rounded-sm border border-destructive/40 text-destructive text-xs font-semibold hover:bg-destructive/10 cursor-pointer"
                >
                  Reject Request
                </button>
              </>
            )}

            {staffStatus === "ACCEPTED" && linkedOrder && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenOrderModal({ type: "READY", order: linkedOrder })}
                  className="h-9 px-3 rounded-sm bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
                >
                  Mark Ready for Pickup
                </button>
                <button
                  type="button"
                  onClick={() => onOpenOrderModal({ type: "CANCEL", order: linkedOrder })}
                  className="h-9 px-3 rounded-sm border border-destructive/40 text-destructive text-xs font-semibold hover:bg-destructive/10 cursor-pointer"
                >
                  Cancel Order
                </button>
              </>
            )}

            {staffStatus === "ACCEPTED" && !linkedOrder && (
              <span className="text-xs text-muted-foreground italic py-1.5">
                Accepted before order tracking was enabled for custom cakes. No order
                record is linked to this request.
              </span>
            )}

            {staffStatus === "READY_FOR_PICKUP" && linkedOrder && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    onOpenOrderModal({ type: "COMPLETE_AND_PAY", order: linkedOrder })
                  }
                  className="h-9 px-3 rounded-sm bg-cocoa text-cream text-xs font-semibold hover:bg-cocoa/90 cursor-pointer"
                >
                  {linkedOrder.payment_status === "paid"
                    ? "Complete Handover"
                    : "Collect Payment & Handover"}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenOrderModal({ type: "NO_SHOW", order: linkedOrder })}
                  className="h-9 px-3 rounded-sm border border-destructive/40 text-destructive text-xs font-semibold hover:bg-destructive/10 cursor-pointer"
                >
                  Mark No Show
                </button>
              </>
            )}

            {staffStatus === "COMPLETED" && linkedOrder && linkedOrder.payment_status !== "paid" && (
              <button
                type="button"
                onClick={() =>
                  onOpenOrderModal({ type: "RECORD_PAYMENT", order: linkedOrder })
                }
                className="h-9 px-3 rounded-sm bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
              >
                Collect Payment ({formatPaise(linkedOrder.total_paise)})
              </button>
            )}

            {staffStatus === "COMPLETED" && linkedOrder?.payment_status === "paid" && (
              <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300 py-1.5">
                {PAYMENT_RECEIVED_HANDOVER_LABEL}
              </span>
            )}

            {(staffStatus === "REJECTED" ||
              staffStatus === "CANCELLED" ||
              staffStatus === "NO_SHOW") && (
              <span className="text-xs text-muted-foreground italic py-1.5">
                This request is {formatOrderStatusLabel(staffStatus).toLowerCase()}
                {linkedOrder?.cancellation_reason ||
                linkedOrder?.rejection_reason ||
                request.decline_reason
                  ? `: ${
                      linkedOrder?.cancellation_reason ||
                      linkedOrder?.rejection_reason ||
                      request.decline_reason
                    }`
                  : "."}
              </span>
            )}
          </div>
            </>
          )}

          {linkedOrder && (
            <div className="pt-2 mt-1 border-t border-border/60 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Order{" "}
                <span className="font-mono font-semibold text-foreground">
                  {linkedOrder.order_number}
                </span>
              </span>
              <span>
                Total{" "}
                <strong className="text-foreground">
                  {formatPaise(linkedOrder.total_paise)}
                </strong>
              </span>
              <span>
                Payment{" "}
                <strong className="text-foreground uppercase">
                  {linkedOrder.payment_status === "paid" ? "Paid" : "Unpaid"}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* Customer Information */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
            Customer Information
          </span>
          <div className="rounded-sm border border-border bg-background p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-foreground text-sm">
                {request.customer_name}
              </span>
              <a
                href={`tel:${request.customer_phone}`}
                className="inline-flex items-center gap-1 text-caramel hover:underline font-semibold shrink-0"
              >
                <Phone className="size-3.5" />
                <span>
                  {request.customer_phone.startsWith("+")
                    ? request.customer_phone
                    : `+91 ${request.customer_phone}`}
                </span>
              </a>
            </div>
            {request.customer_email && (
              <div className="flex items-center gap-1.5 text-muted-foreground pt-1 border-t border-border/50">
                <Mail className="size-3.5 shrink-0" />
                <span>{request.customer_email}</span>
              </div>
            )}
            {referenceImages.length > 0 && (
              <div className="pt-1 border-t border-border/50">
                <button
                  type="button"
                  onClick={showReferencePhoto}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-caramel hover:underline cursor-pointer"
                >
                  <ImageIcon className="size-3.5" />
                  <span>View Reference Photo</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Expand Control Button (Collapsed State Only) */}
        {!isExpanded && (
          <div>
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              aria-expanded={false}
              className="w-full min-h-[48px] rounded-sm border border-border bg-card hover:bg-muted/60 hover:border-caramel/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-foreground hover:text-caramel transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
            >
              <span>View More ↓</span>
            </button>
          </div>
        )}

        {/* Expanded Detailed Sections */}
        {isExpanded && (
          <div className="space-y-6">
            {/* Pickup Schedule */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
                Preferred Pickup Schedule
              </span>
              <div className="rounded-sm border border-border bg-background p-3.5 space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <Calendar className="size-4 text-caramel shrink-0 mt-0.5" />
                  <div>
                    <span className="text-muted-foreground block">Preferred Date:</span>
                    <span className="font-semibold text-foreground text-sm">
                      {formatIstDate(request.preferred_pickup_at)}
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-2 pt-1 border-t border-border/50">
                  <Clock className="size-4 text-caramel shrink-0 mt-0.5" />
                  <div>
                    <span className="text-muted-foreground block">Time Window:</span>
                    <span className="font-semibold text-foreground">
                      Around {formatIstTime(request.preferred_pickup_at)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

        {/* Cake Specifications */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
            Cake Specifications
          </span>
          <div className="rounded-sm border border-border bg-background p-3.5 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-muted-foreground block">Occasion / Type:</span>
                <span className="font-semibold text-foreground">
                  {request.cake_type || "Celebration"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Flavour:</span>
                <span className="font-semibold text-foreground">
                  {request.flavour}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Weight:</span>
                <span className="font-semibold text-foreground">
                  {request.weight_grams >= 1000
                    ? `${request.weight_grams / 1000} kg`
                    : `${request.weight_grams}g`}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Shape:</span>
                <span className="font-semibold text-foreground">
                  {request.shape || "Round"}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-border/50">
              <span className="text-muted-foreground block mb-1">Dietary / Egg Type:</span>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase inline-block ${
                  request.egg_type === "EGGLESS"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                }`}
              >
                {request.egg_type === "EGGLESS" ? "Eggless (Pure Veg)" : "Regular (With Egg)"}
              </span>
            </div>

            {request.message_on_cake && (
              <div className="pt-2 border-t border-border/50">
                <div className="rounded-sm border border-amber-300 bg-amber-50/70 p-2.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
                  <div className="flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-wider text-amber-800 dark:text-amber-300 mb-0.5">
                    <Sparkles className="size-3.5 shrink-0" />
                    <span>Cake Inscription</span>
                  </div>
                  <p className="font-serif italic text-sm pl-5">
                    &ldquo;{request.message_on_cake}&rdquo;
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Theme & Design Instructions */}
        {request.description && (
          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Theme / Design Description
            </span>
            <div className="rounded-sm border border-border bg-background p-3.5 text-xs text-foreground leading-relaxed whitespace-pre-wrap">
              {request.description}
            </div>
          </div>
        )}

        {/* Reference Image Photo(s): private bucket, loaded through short-lived signed URLs */}
        {referenceImages.length > 0 && (
          <div ref={photoSectionRef} className="space-y-2 scroll-mt-24">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Customer Reference Photo
            </span>
            <div className="rounded-sm border border-border bg-background p-3.5 space-y-4">
              {referenceImages.map((img) => (
                <ReferenceImage key={img.id} storagePath={img.storage_path} />
              ))}
            </div>
          </div>
        )}

        {/* Additional Notes or Decline Reasons */}
        {(request.additional_notes || request.decline_reason) && (
          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Notes & Status Explanations
            </span>
            <div className="rounded-sm border border-border bg-background p-3.5 space-y-2 text-xs">
              {request.additional_notes && (
                <div>
                  <span className="font-semibold text-muted-foreground block mb-0.5">
                    Customer Instructions:
                  </span>
                  <p className="text-foreground bg-muted/40 p-2 rounded-xs">
                    {request.additional_notes}
                  </p>
                </div>
              )}
              {request.decline_reason && (
                <div>
                  <span className="font-semibold text-destructive block mb-0.5">
                    Decline Reason:
                  </span>
                  <p className="text-destructive bg-destructive/10 p-2 rounded-xs font-medium">
                    {request.decline_reason}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Staff Messages & Internal Notes */}
        <div className="space-y-2 pb-6">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
            Staff Messages & Internal Notes
          </span>
          <div className="rounded-sm border border-border bg-background p-3.5 space-y-3 text-xs">
            {request.request_messages && request.request_messages.length > 0 ? (
              <div className="space-y-2">
                {request.request_messages.map((msg) => (
                  <div
                    key={msg.id}
                    className="rounded-xs border border-border/80 bg-card p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground text-[11px] uppercase">
                        {msg.sender === "STAFF" ? "Staff Memo" : "Customer Message"}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatIstDateTime(msg.created_at)}
                      </span>
                    </div>
                    <p className="text-foreground">{msg.body}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground italic">No notes recorded yet.</p>
            )}

            {noteError && <p className="text-destructive text-xs">{noteError}</p>}

            {!readOnly && (
            <form onSubmit={handleAddNote} className="flex gap-2 pt-2 border-t border-border/60">
              <input
                type="text"
                placeholder="Add a staff note or memo..."
                value={internalNoteInput}
                onChange={(e) => setInternalNoteInput(e.target.value)}
                disabled={isAddingNote}
                className="flex-1 min-h-[36px] rounded-xs border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel"
              />
              <button
                type="submit"
                disabled={isAddingNote || !internalNoteInput.trim()}
                className="h-9 px-3 rounded-xs bg-cocoa text-cream text-xs font-semibold hover:bg-cocoa/90 disabled:opacity-50 flex items-center gap-1"
              >
                {isAddingNote ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
              </button>
            </form>
            )}
          </div>
        </div>

        {/* Bottom Collapse Button */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            aria-expanded={true}
            className="w-full min-h-[48px] rounded-sm border border-border/80 bg-background hover:bg-muted/60 hover:border-caramel/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-caramel transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
          >
            <span>View Less ↑</span>
          </button>
        </div>
      </div>
    )}
      </div>
    </div>
  );
}
