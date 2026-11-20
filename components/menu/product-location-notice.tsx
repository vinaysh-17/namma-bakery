import { Store, Clock } from "lucide-react";

export const BAKERY_LOCATION = {
  name: "Namma Bakery Kitchen & Counter",
  street: "BEML Layout 3rd Stage",
  locality: "Rajarajeshwari Nagar",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560098",
  fullAddress: "BEML Layout 3rd Stage, Rajarajeshwari Nagar, Bengaluru",
  defaultHours: "10:00 AM – 9:30 PM",
} as const;

interface ProductLocationNoticeProps {
  hoursLabel?: string | null;
}

/**
 * Compact bakery kitchen & counter location section for product detail pages.
 * Relocated below the back-to-category link, right-aligned on desktop,
 * and subtly styled using live business hours.
 */
export function ProductLocationNotice({ hoursLabel }: ProductLocationNoticeProps) {
  const displayHours = hoursLabel
    ? `Counter Hours: ${hoursLabel}`
    : `Counter Hours: ${BAKERY_LOCATION.defaultHours}`;

  return (
    <div className="flex flex-col sm:items-end text-left sm:text-right text-xs text-muted-foreground/80 sm:ml-auto max-w-sm">
      <div className="flex items-center gap-1.5 font-medium text-foreground/90 sm:justify-end">
        <Store className="h-3.5 w-3.5 text-caramel shrink-0" aria-hidden="true" />
        <span>{BAKERY_LOCATION.name}</span>
      </div>
      <p className="mt-1 leading-relaxed text-[11px] sm:text-xs text-muted-foreground">
        {BAKERY_LOCATION.street},
        <span className="sm:hidden"> </span>
        <br className="hidden sm:inline" />
        {BAKERY_LOCATION.locality}, {BAKERY_LOCATION.city}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] sm:text-xs text-muted-foreground/80 sm:justify-end">
        <Clock className="h-3 w-3 text-caramel shrink-0" aria-hidden="true" />
        <span>{displayHours}</span>
      </div>
    </div>
  );
}
