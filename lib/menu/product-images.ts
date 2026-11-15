import { PRODUCT_IMAGE_MANIFEST } from "./product-images-manifest";
import type { ProductImage } from "./types";

/**
 * Normalizes a category or product identifier to a URL-safe lowercase slug.
 * Safely strips punctuation, spaces, and optional parenthesized modifiers (e.g. "(baby size)", "(junior)").
 */
export function normalizeImageSlug(value: string): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "") // strip parenthesized notes
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Searches the static manifest across all categories for a product slug or name.
 * Provides category-resilience: if a product moves to another category, its image
 * does not disappear.
 */
export function findManifestImageBySlug(productSlugOrName?: string | null): string | null {
  if (!productSlugOrName) return null;
  const target = normalizeImageSlug(productSlugOrName);
  if (!target) return null;

  for (const [key, url] of Object.entries(PRODUCT_IMAGE_MANIFEST)) {
    const parts = key.split("/");
    const lastPart = parts[parts.length - 1];
    if (lastPart && normalizeImageSlug(lastPart) === target) {
      return url;
    }
  }

  return null;
}

/**
 * Resolves a local optimized WebP image URL for a given category and product slug or name.
 * Falls back to cross-category slug search if not found in the specified category.
 * Returns null if no local asset is found in the manifest.
 */
export function getLocalProductImageUrl(
  categorySlug?: string | null,
  productSlugOrName?: string | null
): string | null {
  if (!productSlugOrName) return null;

  if (categorySlug) {
    // Direct lookup first
    const directKey = `${categorySlug}/${productSlugOrName}`;
    if (PRODUCT_IMAGE_MANIFEST[directKey]) {
      return PRODUCT_IMAGE_MANIFEST[directKey];
    }

    // Normalized lookup
    const normCat = normalizeImageSlug(categorySlug);
    const normProd = normalizeImageSlug(productSlugOrName);
    const normKey = `${normCat}/${normProd}`;
    if (PRODUCT_IMAGE_MANIFEST[normKey]) {
      return PRODUCT_IMAGE_MANIFEST[normKey];
    }
  }

  // Cross-category fallback: product might have moved between categories (#90)
  return findManifestImageBySlug(productSlugOrName);
}

export interface ResolvedProductImage {
  url: string | null;
  alt: string;
  isLocal: boolean;
}

/**
 * Resolves the primary image for a product.
 * Resolution hierarchy (#90):
 * 1. Admin-uploaded primary image from product_images table in Supabase Storage (preferred)
 * 2. Matching local optimized image from static manifest (direct or cross-category fallback)
 * 3. Null (triggers UI icon placeholder)
 */
export function resolvePrimaryProductImage(product: {
  slug?: string;
  name?: string;
  category?: { slug?: string; name?: string } | null;
  product_images?: ProductImage[] | null;
}): ResolvedProductImage {
  // 1. Admin-uploaded image from database (takes top priority over static assets)
  const primarySupabaseImage =
    product.product_images?.find((img) => img.is_primary) ??
    product.product_images?.[0];

  if (primarySupabaseImage) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const url = primarySupabaseImage.storage_path.startsWith("http")
      ? primarySupabaseImage.storage_path
      : `${supabaseUrl}/storage/v1/object/public/product-images/${primarySupabaseImage.storage_path}`;
    return {
      url,
      alt: primarySupabaseImage.alt_text || product.name || "Bakery item",
      isLocal: false,
    };
  }

  // 2. Local optimized image (with category-resilient fallback)
  const categorySlug = product.category?.slug;
  const localUrl =
    getLocalProductImageUrl(categorySlug, product.slug) ||
    getLocalProductImageUrl(categorySlug, product.name);

  if (localUrl) {
    return {
      url: localUrl,
      alt: `${product.name ?? "Bakery item"} — Handcrafted at Namma Bakery`,
      isLocal: true,
    };
  }

  // 3. Fallback: null triggers UI placeholder
  return {
    url: null,
    alt: product.name || "Bakery item",
    isLocal: false,
  };
}

export interface GalleryDisplayImage {
  id: string;
  url: string;
  alt: string;
  isLocal: boolean;
}

/**
 * Resolves the gallery display images for the product detail page.
 * Returns an ordered list (#90):
 * - Uploaded Supabase storage images (with primary image first)
 * - Local optimized image from manifest (if not duplicated)
 * Returns an empty array if no images exist, prompting the fallback placeholder.
 */
export function resolveGalleryImages(product: {
  slug?: string;
  name?: string;
  category?: { slug?: string } | null;
  product_images?: ProductImage[] | null;
}): GalleryDisplayImage[] {
  const result: GalleryDisplayImage[] = [];
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // 1. Uploaded Supabase images (primary first, then by sort_order)
  if (product.product_images && product.product_images.length > 0) {
    const sortedImages = [...product.product_images].sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return a.sort_order - b.sort_order;
    });

    for (const img of sortedImages) {
      const url = img.storage_path.startsWith("http")
        ? img.storage_path
        : `${supabaseUrl}/storage/v1/object/public/product-images/${img.storage_path}`;

      if (!result.some((r) => r.url === url)) {
        result.push({
          id: img.id,
          url,
          alt: img.alt_text || product.name || "Product photo",
          isLocal: false,
        });
      }
    }
  }

  // 2. Local manifest image as fallback (or secondary if gallery is empty)
  const categorySlug = product.category?.slug;
  const localUrl =
    getLocalProductImageUrl(categorySlug, product.slug) ||
    getLocalProductImageUrl(categorySlug, product.name);

  if (localUrl && !result.some((r) => r.url === localUrl)) {
    result.push({
      id: "local-primary",
      url: localUrl,
      alt: `${product.name ?? "Bakery item"} — Handcrafted at Namma Bakery`,
      isLocal: true,
    });
  }

  return result;
}
