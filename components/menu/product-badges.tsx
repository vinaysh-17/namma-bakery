interface ProductBadgesProps {
  isBestSeller?: boolean;
  isFeatured?: boolean;
  isNewArrival?: boolean;
  isSeasonal?: boolean;
}

export function ProductBadges({
  isBestSeller,
  isFeatured,
  isSeasonal,
}: ProductBadgesProps) {
  // Note: New Arrival badge is displayed on listing cards, not inside product detail pages
  const hasBadges = isBestSeller || isFeatured || isSeasonal;
  if (!hasBadges) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isBestSeller && (
        <span className="rounded-xs border border-caramel/30 bg-caramel/10 px-2.5 py-1 text-xs font-semibold tracking-wide text-caramel uppercase">
          Best Seller
        </span>
      )}
      {isFeatured && !isBestSeller && (
        <span className="rounded-xs border border-border bg-card px-2.5 py-1 text-xs font-medium tracking-wide text-foreground uppercase">
          Featured
        </span>
      )}
      {isSeasonal && (
        <span className="rounded-xs border border-amber-500/30 bg-amber-50 px-2.5 py-1 text-xs font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-950/30 dark:text-amber-300">
          Seasonal Special
        </span>
      )}
    </div>
  );
}
