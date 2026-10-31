import type { Metadata } from "next";
import { getMenuCategories, getMenuProducts } from "@/lib/menu/queries";
import { CategoryNav } from "@/components/menu/category-nav";
import { ProductGrid } from "@/components/menu/product-grid";
import { MenuEmptyState } from "@/components/menu/menu-empty-state";
import { MenuErrorState } from "@/components/menu/menu-error-state";
import { CustomCakeBanner } from "@/components/menu/custom-cake-banner";

export const instant = false;

export const metadata: Metadata = {
  title: "Bakery Menu — Handcrafted Cakes & Fresh Bakes",
  description:
    "Explore our complete bakery menu including fresh celebration cakes, savoury snacks, pastries, and daily treats in RR Nagar, Bengaluru. Available for bakery pickup.",
  alternates: {
    canonical: "/menu",
  },
  openGraph: {
    title: "Bakery Menu — Handcrafted Cakes & Fresh Bakes | Namma Bakery",
    description:
      "Explore our complete bakery menu including fresh celebration cakes, savoury snacks, pastries, and daily treats in RR Nagar, Bengaluru.",
    url: "/menu",
  },
};

export default async function MenuPage() {
  const [categoriesResult, productsResult] = await Promise.all([
    getMenuCategories(),
    getMenuProducts(),
  ]);

  if (categoriesResult.error || productsResult.error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <MenuErrorState />
      </div>
    );
  }

  const categories = categoriesResult.data;
  const products = productsResult.data;

  return (
    <div className="pt-3 pb-8 sm:pt-4 sm:pb-12">
      {/* Introduction & Custom Cake Promotional Section (Scrolls away normally) */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-4 sm:mb-5">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Bakery Menu
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Fresh celebration cakes, savoury snacks, and neighbourhood classics.
          </p>
        </div>

        {/* Custom Cake Enquiry Banner */}
        <CustomCakeBanner />
      </div>

      {/* Sticky Category Navigation */}
      {categories.length > 0 && (
        <CategoryNav categories={categories} />
      )}

      {/* Product Catalog */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 mt-4 sm:mt-6">
        {products.length === 0 ? (
          <MenuEmptyState
            title="No menu items currently listed"
            message="We are currently updating our digital menu with fresh items. Please visit us in store or check back soon."
            showAllLink={false}
          />
        ) : (
          <ProductGrid products={products} />
        )}
      </div>
    </div>
  );
}
