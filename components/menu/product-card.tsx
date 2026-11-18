"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Cake,
  UtensilsCrossed,
  Soup,
  ShoppingBag,
  Check,
  Plus,
  Minus,
} from "lucide-react";
import type { Product } from "@/lib/menu/types";
import {
  describeInvalidSelection,
  getOrderableVariants,
  resolveSimpleProductSelection,
} from "@/lib/menu/variant-availability";
import { checkItemBeforeAdd } from "@/lib/cart/add-check";
import { formatPaise } from "@/lib/utils/money";
import { hasMultiplePrices } from "@/lib/menu/utils";
import { resolvePrimaryProductImage } from "@/lib/menu/product-images";
import { useCart } from "@/lib/cart/context";
import { generateCartItemKey } from "@/lib/cart/key";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  product: Product;
  preload?: boolean;
  priority?: boolean;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
}

function renderPlaceholderIcon(kind: string, categorySlug?: string) {
  if (kind === "TIERED_CAKE" || categorySlug === "cakes") {
    return <Cake className="h-12 w-12 stroke-[1.5]" />;
  }
  if (categorySlug === "soups") {
    return <Soup className="h-12 w-12 stroke-[1.5]" />;
  }
  return <UtensilsCrossed className="h-12 w-12 stroke-[1.5]" />;
}

export function isCakeProduct(product: Product, categorySlug?: string): boolean {
  if (product.kind === "TIERED_CAKE") return true;
  if (product.category?.slug === "cakes") return true;
  if (categorySlug === "cakes") return true;
  return false;
}

/**
 * Cake Product Card
 * Opens product detail page for custom cake configuration (weight, egg preference, finish, tier rules).
 */
function CakeProductCard({
  product,
  preload,
  priority,
  loading,
  fetchPriority,
}: {
  product: Product;
  preload?: boolean;
  priority?: boolean;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
}) {
  const shouldPreload = Boolean(preload ?? priority);
  const resolvedLoading = shouldPreload ? undefined : loading;
  const resolvedFetchPriority = fetchPriority ?? (shouldPreload ? "high" : undefined);
  const categorySlug = product.category?.slug ?? "cakes";
  const formattedPrice =
    typeof product.startingPricePaise === "number" &&
    product.startingPricePaise > 0
      ? formatPaise(product.startingPricePaise)
      : null;

  const showFromPrice = hasMultiplePrices(product);
  const { url: imageUrl, alt: imageAlt } = resolvePrimaryProductImage(product);

  return (
    <Link
      href={`/menu/${categorySlug}/${product.slug}`}
      className="group flex flex-col justify-between overflow-hidden rounded-sm border border-border bg-card transition-all duration-300 hover:border-caramel/60 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
    >
      <div>
        {/* Visual Header / Image */}
        <div className="relative flex aspect-16/9 sm:aspect-4/3 w-full items-center justify-center overflow-hidden border-b border-border bg-secondary/50 text-caramel/70 transition-colors duration-300 group-hover:bg-secondary/70">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={imageAlt}
              fill
              preload={shouldPreload || undefined}
              loading={resolvedLoading}
              fetchPriority={resolvedFetchPriority}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover object-center transition-transform duration-500 ease-out sm:group-hover:scale-[1.025]"
            />
          ) : (
            <div className="p-6">
              {renderPlaceholderIcon(product.kind, categorySlug)}
            </div>
          )}

          {/* Badges on listing card */}
          <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
            {product.is_new_arrival && (
              <span className="rounded-xs border border-emerald-500/30 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-emerald-800 uppercase dark:bg-emerald-950/30 dark:text-emerald-300">
                New Arrival
              </span>
            )}
            {product.is_best_seller && (
              <span className="rounded-xs border border-caramel/30 bg-caramel/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-caramel uppercase">
                Best Seller
              </span>
            )}
            {product.is_featured && !product.is_best_seller && (
              <span className="rounded-xs border border-border bg-card px-2 py-0.5 text-[11px] font-medium tracking-wide text-foreground uppercase">
                Featured
              </span>
            )}
            {!product.orderable_online && (
              <span className="rounded-xs border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                In-Store Only
              </span>
            )}
          </div>
        </div>

        {/* Body Content */}
        <div className="p-4">
          <h3 className="font-heading text-base font-semibold text-foreground transition-colors group-hover:text-caramel">
            {product.name}
          </h3>
          {product.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}
        </div>
      </div>

      {/* Meta Footer */}
      <div className="px-4 pb-4 pt-2 flex items-center border-t border-border/60 text-xs text-muted-foreground">
        {formattedPrice ? (
          <span className="font-heading text-sm font-semibold text-foreground">
            {showFromPrice ? `From ${formattedPrice}` : formattedPrice}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">
            Ask in store
          </span>
        )}
      </div>
    </Link>
  );
}

/**
 * Normal Food Product Card (Sandwiches, Mini Pizzas, Soups, etc.)
 * Provides direct variant selection, explicit quantity increment/decrement, and Add to Cart from the listing.
 */
function SimpleProductCard({
  product,
  preload,
  priority,
  loading,
  fetchPriority,
}: {
  product: Product;
  preload?: boolean;
  priority?: boolean;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
}) {
  const shouldPreload = Boolean(preload ?? priority);
  const resolvedLoading = shouldPreload ? undefined : loading;
  const resolvedFetchPriority = fetchPriority ?? (shouldPreload ? "high" : undefined);
  const { addItem } = useCart();
  const router = useRouter();
  const categorySlug = product.category?.slug ?? "menu";
  const { url: imageUrl, alt: imageAlt } = resolvePrimaryProductImage(product);

  // The variant shown as selected is a real selection: it starts as the first orderable variant
  // and is never silently replaced if it later becomes unavailable (#77).
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    () => getOrderableVariants(product.product_variants)[0]?.id ?? ""
  );
  // One shared rule for "which variant, what price, can it be ordered" (#77)
  const selection = resolveSimpleProductSelection({
    product,
    selectedVariantId,
    startingPricePaise: product.startingPricePaise,
  });
  const availableVariants = selection.orderableVariants;
  const activeVariant = selection.activeVariant;
  const currentPricePaise = selection.pricePaise;
  const canOrder = selection.canOrder;
  const variantsUnavailable = selection.purchaseState === "VARIANTS_UNAVAILABLE";
  const selectionInvalid = selection.selectionInvalid;
  const invalidSelectionMessage = selectionInvalid
    ? describeInvalidSelection(
        product.product_variants?.find((v) => v.id === selectedVariantId)?.label
      )
    : null;

  // Accessible names for the disabled controls say WHY the product cannot be ordered
  const orderBlockedLabel =
    !product.is_available || variantsUnavailable
      ? `${product.name} is currently unavailable`
      : !product.orderable_online
      ? `${product.name} is available in-store only`
      : selectionInvalid
      ? `Choose an option for ${product.name} first`
      : `${product.name} cannot be ordered online right now`;
  const detailsLabel =
    !product.is_available || variantsUnavailable
      ? `View details for ${product.name} (currently unavailable)`
      : !product.orderable_online
      ? `View details for ${product.name} (in-store only)`
      : `View details for ${product.name}`;

  const [quantity, setQuantity] = useState<number>(0);
  const [justAdded, setJustAdded] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  // Set when the live menu says the item can no longer be ordered (menu was open for a while)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [isCheckingAdd, setIsCheckingAdd] = useState(false);

  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(false), 2000);
    return () => clearTimeout(timer);
  }, [justAdded]);

  useEffect(() => {
    if (!warningMessage) return;
    const timer = setTimeout(() => setWarningMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [warningMessage]);

  // Add to Cart is enabled ONLY when the customer has explicitly selected a quantity > 0
  const canAddToCart = canOrder && quantity > 0 && !isCheckingAdd;

  const handleAddToCart = async () => {
    // Defensive guard: if somehow triggered while quantity is 0, show message and do not add to cart
    if (quantity <= 0) {
      setWarningMessage("Add a quantity first");
      return;
    }

    if (!canOrder || currentPricePaise === null || isCheckingAdd) {
      return;
    }

    // The menu may have been open for a while: confirm with the server that this item and
    // variant can still be ordered before it goes into the cart.
    setIsCheckingAdd(true);
    const blocked = await checkItemBeforeAdd({
      productId: product.id,
      variantId: activeVariant?.id,
      quantity,
      productName: product.name,
    });
    setIsCheckingAdd(false);
    if (blocked) {
      setBlockedMessage(blocked);
      setQuantity(0);
      router.refresh(); // reload the menu so the card shows the current availability
      return;
    }
    setBlockedMessage(null);

    const itemKey = generateCartItemKey({
      productId: product.id,
      kind: "SIMPLE",
      variantId: activeVariant?.id,
    });

    addItem({
      itemKey,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      productNameKn: null,
      categorySlug,
      kind: "SIMPLE",
      variantId: activeVariant?.id,
      variantLabel: activeVariant?.label,
      unitPricePaise: currentPricePaise,
      quantity, // Exactly the explicitly selected quantity
      leadTimeMinutes: product.lead_time_minutes,
    });

    setWarningMessage(null);
    setJustAdded(true);
    setQuantity(0); // Reset quantity control to [ Add ] and disable Add to Cart again
  };

  return (
    <div className="relative group flex flex-col justify-between overflow-hidden rounded-sm border border-border bg-card transition-all duration-300 hover:border-caramel/60 hover:shadow-xs">
      <div>
        {/* Visual Header / Image - clicking navigates to detail page without interfering with controls */}
        <Link
          href={`/menu/${categorySlug}/${product.slug}`}
          className="relative flex aspect-16/9 sm:aspect-4/3 w-full items-center justify-center overflow-hidden border-b border-border bg-secondary/50 text-caramel/70 transition-colors duration-300 group-hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel"
          aria-label={detailsLabel}
        >
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={imageAlt}
              fill
              preload={shouldPreload || undefined}
              loading={resolvedLoading}
              fetchPriority={resolvedFetchPriority}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover object-center transition-transform duration-500 ease-out sm:group-hover:scale-[1.025]"
            />
          ) : (
            <div className="p-6">
              {renderPlaceholderIcon(product.kind, categorySlug)}
            </div>
          )}

          {/* Badges on listing card */}
          <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
            {product.is_new_arrival && (
              <span className="rounded-xs border border-emerald-500/30 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-emerald-800 uppercase dark:bg-emerald-950/30 dark:text-emerald-300">
                New Arrival
              </span>
            )}
            {product.is_best_seller && (
              <span className="rounded-xs border border-caramel/30 bg-caramel/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-caramel uppercase">
                Best Seller
              </span>
            )}
            {product.is_featured && !product.is_best_seller && (
              <span className="rounded-xs border border-border bg-card px-2 py-0.5 text-[11px] font-medium tracking-wide text-foreground uppercase">
                Featured
              </span>
            )}
            {!product.orderable_online && (
              <span className="rounded-xs border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                In-Store Only
              </span>
            )}
            {variantsUnavailable && (
              <span className="rounded-xs border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                Unavailable
              </span>
            )}
          </div>
        </Link>

        {/* Body Content */}
        <div className="p-3.5 sm:p-4">
          {/* Product Name (English only) */}
          <Link
            href={`/menu/${categorySlug}/${product.slug}`}
            className="font-heading text-sm sm:text-base font-semibold text-foreground transition-colors hover:text-caramel line-clamp-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel min-h-[32px] sm:min-h-[28px] inline-flex items-center"
          >
            {product.name}
          </Link>

          {/* Price & Variant Selector row */}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            {/* Top-left: Displayed price */}
            {variantsUnavailable ? (
              <span className="font-heading text-sm sm:text-base font-semibold text-muted-foreground">
                Currently unavailable
              </span>
            ) : (
              <span className="font-heading text-sm sm:text-base font-bold text-foreground">
                {currentPricePaise !== null
                  ? formatPaise(currentPricePaise)
                  : selectionInvalid
                  ? "Choose an option"
                  : "Ask in store"}
              </span>
            )}

            {/* Top-right: Variant selector */}
            {availableVariants.length === 1 && !selectionInvalid && (
              <span className="text-[11px] sm:text-xs font-medium text-muted-foreground">
                {availableVariants[0].label}
              </span>
            )}

            {((availableVariants.length >= 2 && availableVariants.length <= 3) ||
              (selectionInvalid && availableVariants.length === 1)) && (
              <div
                className="flex items-center gap-1.5 flex-wrap"
                role="group"
                aria-label="Portion size options"
              >
                {availableVariants.map((variant) => {
                  const isSelected = variant.id === activeVariant?.id;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setBlockedMessage(null);
                        setSelectedVariantId(variant.id);
                      }}
                      aria-pressed={isSelected}
                      className={cn(
                        "rounded-xs min-h-[32px] sm:min-h-[28px] px-2.5 py-1 text-xs font-medium inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel",
                        isSelected
                          ? "bg-caramel text-white font-semibold shadow-xs"
                          : "border border-border bg-secondary/40 text-foreground hover:bg-secondary"
                      )}
                    >
                      {variant.label}
                    </button>
                  );
                })}
              </div>
            )}

            {availableVariants.length > 3 && (
              <select
                value={activeVariant?.id ?? ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  setBlockedMessage(null);
                  setSelectedVariantId(e.target.value);
                }}
                aria-label="Select variant"
                className="h-8 sm:h-7 rounded-xs border border-border bg-card px-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
              >
                {!activeVariant && (
                  <option value="" disabled>
                    Select an option
                  </option>
                )}
                {availableVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {invalidSelectionMessage && (
        <p
          role="alert"
          className="px-3.5 pb-2 text-[11px] leading-snug font-medium text-destructive sm:px-4"
        >
          {invalidSelectionMessage}
        </p>
      )}

      {blockedMessage && !selectionInvalid && (
        <p
          role="alert"
          className="px-3.5 pb-2 text-[11px] leading-snug font-medium text-destructive sm:px-4"
        >
          {blockedMessage}
        </p>
      )}

      {/* Action Row: Quantity / Add on Left, Add to Cart on Right */}
      <div className="relative px-3.5 pb-3.5 sm:px-4 sm:pb-4 pt-2.5 border-t border-border/60 flex items-center justify-between gap-2">
        {/* Defensive warning toast / feedback message */}
        {warningMessage && (
          <div
            role="alert"
            aria-live="polite"
            className="absolute bottom-12 right-2 z-20 flex items-center gap-1.5 rounded-xs border border-amber-400 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 shadow-md animate-in fade-in slide-in-from-bottom-1 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-700 pointer-events-none"
          >
            <span>{warningMessage}</span>
          </div>
        )}

        {/* Bottom-left: Initial [ Add ] -> Transforms into [ − ] 1 [ + ] */}
        {quantity === 0 || !canOrder ? (
          <button
            type="button"
            disabled={!canOrder}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setWarningMessage(null);
              setQuantity(1);
            }}
            className={cn(
              "flex h-8 min-w-[64px] sm:min-w-[70px] items-center justify-center rounded-xs border border-caramel/40 px-2.5 text-xs font-semibold text-caramel transition-colors hover:bg-caramel/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel active:scale-95",
              !canOrder &&
                "opacity-50 cursor-not-allowed border-border text-muted-foreground hover:bg-transparent"
            )}
            aria-label={canOrder ? `Select quantity for ${product.name}` : orderBlockedLabel}
          >
            Add
          </button>
        ) : (
          <div
            className="inline-flex h-8 items-center rounded-xs border border-caramel/50 bg-caramel/5 text-xs"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setQuantity((q) => Math.max(0, q - 1));
              }}
              className="flex h-full w-7 items-center justify-center text-caramel hover:bg-caramel/20 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel rounded-l-xs"
              aria-label="Decrease quantity"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="min-w-[20px] sm:min-w-[24px] text-center font-bold text-caramel tabular-nums">
              {quantity}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setQuantity((q) => Math.min(20, q + 1));
              }}
              className="flex h-full w-7 items-center justify-center text-caramel hover:bg-caramel/20 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel rounded-r-xs"
              aria-label="Increase quantity"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Bottom-right: Add to Cart button (Disabled until quantity > 0) */}
        <div
          className="relative inline-flex"
          onClick={(e) => {
            if (canOrder && quantity <= 0) {
              e.preventDefault();
              e.stopPropagation();
              setWarningMessage("Add a quantity first");
            }
          }}
        >
          <button
            type="button"
            disabled={!canAddToCart}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleAddToCart();
            }}
            aria-label={
              !canOrder
                ? orderBlockedLabel
                : isCheckingAdd
                ? `Checking that ${product.name} is still available`
                : justAdded
                ? `Added ${quantity} of ${product.name} to cart`
                : canAddToCart
                ? `Add to Cart: ${quantity} of ${product.name}`
                : selectionInvalid
                ? `Choose option for ${product.name}`
                : `Select a quantity for ${product.name} first`
            }
            className={cn(
              "flex h-8 items-center justify-center gap-1.5 rounded-xs px-3 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel",
              !canAddToCart
                ? "bg-muted text-muted-foreground/70 cursor-not-allowed border border-border/50"
                : justAdded
                ? "bg-emerald-600 text-white font-medium shadow-xs"
                : "bg-caramel text-white hover:bg-caramel/90 active:scale-[0.98] shadow-xs"
            )}
          >
            {justAdded ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Added</span>
              </>
            ) : (
              <>
                <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {!product.is_available || variantsUnavailable
                    ? "Unavailable"
                    : !product.orderable_online
                    ? "In-Store"
                    : selectionInvalid
                    ? "Choose option"
                    : "Add to Cart"}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProductCard({
  product,
  preload,
  priority,
  loading,
  fetchPriority,
}: ProductCardProps) {
  const categorySlug = product.category?.slug;
  const isCake = isCakeProduct(product, categorySlug);

  if (isCake) {
    return (
      <CakeProductCard
        product={product}
        preload={preload}
        priority={priority}
        loading={loading}
        fetchPriority={fetchPriority}
      />
    );
  }

  return (
    <SimpleProductCard
      product={product}
      preload={preload}
      priority={priority}
      loading={loading}
      fetchPriority={fetchPriority}
    />
  );
}
