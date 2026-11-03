/**
 * Single source of truth, on the storefront, for "can this product / variant be ordered?"
 * (GitHub issue #77). Pure functions with no server or browser imports so they can be tested.
 *
 * The database remains the authority: place_order only accepts a variant that is available and
 * not archived, and the live cart check (#75) reports anything that changed. These rules only
 * stop the menu from OFFERING something that cannot be ordered.
 */

export interface VariantLike {
  is_available: boolean;
  price_paise: number;
  archived_at?: string | null;
  sort_order?: number;
}

/** Variants the customer can actually choose: available, priced and not archived. */
export function getOrderableVariants<T extends VariantLike>(
  variants: T[] | null | undefined
): T[] {
  return (variants ?? [])
    .filter((v) => v.is_available && v.price_paise > 0 && !v.archived_at)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * Whether the product HAS variants at all (archived ones don't count). This must be judged on
 * every variant, never on the orderable ones: a product whose variants are all unavailable
 * still "has variants" and must not fall back to being a variant-less product.
 */
export function hasAnyVariants<T extends VariantLike>(
  variants: T[] | null | undefined
): boolean {
  return (variants ?? []).some((v) => !v.archived_at);
}

export type SimpleProductPurchaseState =
  | "AVAILABLE"
  | "PRODUCT_UNAVAILABLE" // switched off by the bakery
  | "IN_STORE_ONLY" // not orderable online
  | "VARIANTS_UNAVAILABLE"; // has variants, none of them can be ordered

export function getSimpleProductPurchaseState(product: {
  is_available: boolean;
  orderable_online: boolean;
  product_variants?: VariantLike[] | null;
}): SimpleProductPurchaseState {
  if (!product.is_available) return "PRODUCT_UNAVAILABLE";
  if (!product.orderable_online) return "IN_STORE_ONLY";
  if (
    hasAnyVariants(product.product_variants) &&
    getOrderableVariants(product.product_variants).length === 0
  ) {
    return "VARIANTS_UNAVAILABLE";
  }
  return "AVAILABLE";
}

export interface SimpleProductSelection<V extends VariantLike & { id: string }> {
  purchaseState: SimpleProductPurchaseState;
  orderableVariants: V[];
  /**
   * The variant that would be added. It is the one the customer chose, and ONLY that one: if
   * the chosen variant is no longer orderable it is never replaced by another (see
   * `selectionInvalid`). When nothing has been chosen yet it is the first orderable variant.
   */
  activeVariant: V | undefined;
  /**
   * The customer had a variant selected and it is no longer orderable (switched off, archived
   * or removed) while other variants are still available. They must choose again explicitly.
   */
  selectionInvalid: boolean;
  pricePaise: number | null;
  canOrder: boolean;
}

/**
 * The one decision used by both the menu card and the product page: given the product, the
 * variant the customer picked and the starting price, what is selected and can it be ordered?
 *
 * A product that HAS variants can only be ordered through an orderable variant. It never falls
 * back to the variant-less starting price (issue #77). A product with no variants at all keeps
 * its product-level behaviour (a starting price is required).
 *
 * A variant the customer chose is never silently swapped for another one: if it stops being
 * orderable the selection becomes invalid (no active variant, no price, cannot order) until
 * they pick a variant themselves. "" means nothing has been chosen yet, which defaults to the
 * first orderable variant.
 */
export function resolveSimpleProductSelection<V extends VariantLike & { id: string }>(params: {
  product: {
    is_available: boolean;
    orderable_online: boolean;
    product_variants?: V[] | null;
  };
  selectedVariantId: string;
  startingPricePaise?: number | null;
}): SimpleProductSelection<V> {
  const { product, selectedVariantId, startingPricePaise } = params;
  const orderableVariants = getOrderableVariants(product.product_variants);
  const hasVariants = hasAnyVariants(product.product_variants);
  const purchaseState = getSimpleProductPurchaseState(product);
  const chosenVariant = selectedVariantId
    ? orderableVariants.find((v) => v.id === selectedVariantId)
    : undefined;
  const selectionInvalid =
    selectedVariantId !== "" && orderableVariants.length > 0 && chosenVariant === undefined;
  const activeVariant = selectedVariantId === "" ? orderableVariants[0] : chosenVariant;
  const pricePaise = activeVariant
    ? activeVariant.price_paise
    : !hasVariants && typeof startingPricePaise === "number" && startingPricePaise > 0
      ? startingPricePaise
      : null;
  const canOrder =
    purchaseState === "AVAILABLE" &&
    pricePaise !== null &&
    (!hasVariants || activeVariant !== undefined);
  return { purchaseState, orderableVariants, activeVariant, selectionInvalid, pricePaise, canOrder };
}

/** Shown when the variant the customer had chosen is no longer available. */
export function describeInvalidSelection(variantLabel?: string | null): string {
  return variantLabel
    ? `"${variantLabel}" is no longer available. Please choose another option.`
    : "The option you chose is no longer available. Please choose another option.";
}

/** Customer-facing text for a cart item the live menu says can no longer be ordered. */
export function describeUnavailableOnAdd(
  status: "PRODUCT_NOT_FOUND" | "PRODUCT_UNAVAILABLE" | "OPTION_NOT_AVAILABLE",
  productName: string
): string {
  return status === "OPTION_NOT_AVAILABLE"
    ? `That option for ${productName} is no longer available. The menu has been refreshed.`
    : `${productName} is no longer available. The menu has been refreshed.`;
}
