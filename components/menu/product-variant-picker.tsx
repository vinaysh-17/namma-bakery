"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Check, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ProductVariant } from "@/lib/menu/types";
import {
  describeInvalidSelection,
  getOrderableVariants,
  resolveSimpleProductSelection,
} from "@/lib/menu/variant-availability";
import { checkItemBeforeAdd } from "@/lib/cart/add-check";
import { formatPaise } from "@/lib/utils/money";
import { useCart } from "@/lib/cart/context";
import { generateCartItemKey } from "@/lib/cart/key";
import { ProductQuantitySelector } from "./product-quantity-selector";

interface ProductVariantPickerProps {
  product: {
    id: string;
    slug: string;
    name: string;
    name_kn?: string | null;
    is_available: boolean;
    orderable_online: boolean;
    requires_confirmation: boolean;
    lead_time_minutes?: number;
  };
  categorySlug: string;
  variants?: ProductVariant[];
  startingPricePaise?: number | null;
}

export function ProductVariantPicker({
  product,
  categorySlug,
  variants = [],
  startingPricePaise,
}: ProductVariantPickerProps) {
  const { addItem } = useCart();
  const router = useRouter();
  const [justAdded, setJustAdded] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [isCheckingAdd, setIsCheckingAdd] = useState(false);

  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(false), 4000);
    return () => clearTimeout(timer);
  }, [justAdded]);

  // The variant shown as selected is a real selection: it starts as the first orderable variant
  // and is never silently replaced if it later becomes unavailable (#77).
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    () => getOrderableVariants(variants)[0]?.id ?? ""
  );

  // One shared rule for "which variant, what price, can it be ordered" (#77), the same one the
  // menu card uses. A product whose variants are all unavailable cannot be added.
  const selection = resolveSimpleProductSelection({
    product: {
      is_available: product.is_available,
      orderable_online: product.orderable_online,
      product_variants: variants,
    },
    selectedVariantId,
    startingPricePaise,
  });
  const availableVariants = selection.orderableVariants;
  const activeVariant = selection.activeVariant;
  const currentPricePaise = selection.pricePaise;
  const purchaseState = selection.purchaseState;
  const isOrderable = purchaseState === "AVAILABLE";
  const canAddToCart = selection.canOrder && !isCheckingAdd;
  const selectionInvalid = selection.selectionInvalid;
  const invalidSelectionMessage = selectionInvalid
    ? describeInvalidSelection(variants.find((v) => v.id === selectedVariantId)?.label)
    : null;

  const totalPricePaise =
    currentPricePaise !== null ? currentPricePaise * quantity : null;

  const handleAddToCart = async () => {
    if (!canAddToCart || currentPricePaise === null) return;

    // The page may have been open for a while: confirm with the server first
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
      router.refresh();
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
      productNameKn: product.name_kn,
      categorySlug,
      kind: "SIMPLE",
      variantId: activeVariant?.id,
      variantLabel: activeVariant?.label,
      unitPricePaise: currentPricePaise,
      quantity,
      leadTimeMinutes: product.lead_time_minutes,
    });

    setJustAdded(true);
    setQuantity(1);
  };

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-border bg-card p-5 sm:p-6">
      {/* Price Display */}
      <div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Price
        </span>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {currentPricePaise !== null
              ? formatPaise(currentPricePaise)
              : selectionInvalid
              ? "Select a size"
              : "Ask in store"}
          </span>
          {activeVariant && availableVariants.length > 1 && (
            <span className="text-xs text-muted-foreground">
              for {activeVariant.label}
            </span>
          )}
        </div>
      </div>

      {/* Multiple variants selector if applicable */}
      {(availableVariants.length > 1 || (selectionInvalid && availableVariants.length > 0)) && (
        <div className="border-t border-border pt-4">
          <label className="block text-xs font-medium text-foreground uppercase tracking-wider">
            Select Portion / Size
          </label>
          {invalidSelectionMessage && (
            <p role="alert" className="mt-2 text-xs font-medium text-destructive">
              {invalidSelectionMessage}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {availableVariants.map((variant) => {
              const isSelected = variant.id === activeVariant?.id;

              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => {
                    setBlockedMessage(null);
                    setSelectedVariantId(variant.id);
                  }}
                  aria-pressed={isSelected}
                  className={`flex h-12 items-center justify-between gap-3 rounded-sm px-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel ${
                    isSelected
                      ? "border-2 border-caramel bg-caramel/10 text-caramel font-semibold"
                      : "border border-border bg-card text-foreground hover:bg-secondary"
                  }`}
                >
                  <span>{variant.label}</span>
                  <span className="text-muted-foreground">
                    {formatPaise(variant.price_paise)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Add to Cart Action */}
      <div className="border-t border-border pt-4 flex flex-col gap-4">
        {isOrderable && (
          <ProductQuantitySelector
            quantity={quantity}
            onChange={setQuantity}
            min={1}
            max={20}
            disabled={!canAddToCart}
            productName={product.name}
            unitPricePaise={currentPricePaise}
          />
        )}

        <button
          type="button"
          disabled={!canAddToCart}
          onClick={handleAddToCart}
          aria-label={
            selectionInvalid
              ? `Choose an option for ${product.name} before adding it to the cart`
              : totalPricePaise !== null
              ? `Add ${quantity} of ${product.name}${
                  activeVariant ? ` (${activeVariant.label})` : ""
                } to cart for ${formatPaise(totalPricePaise)}`
              : "Product cannot be added to cart"
          }
          className={`flex h-12 w-full items-center justify-center gap-2 rounded-sm px-6 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel ${
            canAddToCart
              ? "bg-caramel text-white hover:bg-caramel/90 active:scale-[0.99]"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          <span>
            {!product.is_available || purchaseState === "VARIANTS_UNAVAILABLE"
              ? "Currently Unavailable"
              : !product.orderable_online
              ? "Available In-Store Only"
              : selectionInvalid
              ? "Select a size to continue"
              : totalPricePaise !== null
              ? `Add to Cart • ${formatPaise(totalPricePaise)}`
              : "Unavailable"}
          </span>
        </button>

        {blockedMessage && !selectionInvalid && (
          <p
            role="alert"
            className="rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs font-medium text-destructive"
          >
            {blockedMessage}
          </p>
        )}

        {/* Confirmation feedback */}
        {justAdded && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between rounded-sm border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900 transition-all animate-in fade-in"
          >
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-700" />
              <span className="font-medium">Added to cart!</span>
            </div>
            <Link
              href="/cart"
              className="font-semibold text-emerald-800 underline hover:text-emerald-950 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-700"
            >
              View Cart →
            </Link>
          </div>
        )}

        {product.requires_confirmation && isOrderable && (
          <p className="text-[11px] text-muted-foreground">
            * This item requires confirmation from our kitchen team after order placement.
          </p>
        )}
      </div>
    </div>
  );
}
