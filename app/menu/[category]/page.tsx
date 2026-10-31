import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import {
  getCategoryBySlug,
  getMenuCategories,
  getMenuProducts,
} from "@/lib/menu/queries";
import { CategoryNav } from "@/components/menu/category-nav";
import { ProductGrid } from "@/components/menu/product-grid";
import { MenuEmptyState } from "@/components/menu/menu-empty-state";
import { MenuErrorState } from "@/components/menu/menu-error-state";

export const instant = false;

interface CategoryPageProps {
  params: Promise<{ category: string }>;
}

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  await connection();
  const { category: slug } = await params;
  const { data: category } = await getCategoryBySlug(slug);

  if (!category) {
    return {
      title: "Category Not Found",
      robots: { index: false, follow: true },
    };
  }

  const desc =
    category.description ??
    `Freshly prepared ${category.name.toLowerCase()} at Namma Bakery in RR Nagar, Bengaluru. Available for bakery counter pickup.`;

  return {
    title: `${category.name} — Bakery Menu`,
    description: desc,
    alternates: {
      canonical: `/menu/${category.slug}`,
    },
    openGraph: {
      title: `${category.name} — Bakery Menu | Namma Bakery`,
      description: desc,
      url: `/menu/${category.slug}`,
    },
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  await connection();
  const { category: slug } = await params;

  const [categoryResult, categoriesResult] = await Promise.all([
    getCategoryBySlug(slug),
    getMenuCategories(),
  ]);

  if (categoryResult.error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <MenuErrorState message="Could not load this category right now." />
      </div>
    );
  }

  const category = categoryResult.data;

  // Clean 404 if category slug doesn't exist in Supabase
  if (!category) {
    notFound();
  }

  const { data: products, error: productsError } = await getMenuProducts({
    categoryId: category.id,
    categorySlug: category.slug,
  });

  if (productsError) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <MenuErrorState message="Could not load items for this category." />
      </div>
    );
  }

  const categories = categoriesResult.data ?? [];

  return (
    <div className="pt-3 pb-8 sm:pt-4 sm:pb-12">
      {/* Category Header & Breadcrumb (Scrolls away normally) */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Breadcrumb back navigation */}
        <div className="mb-2">
          <Link
            href="/menu"
            className="inline-flex items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-caramel focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>All Menu Categories</span>
          </Link>
        </div>

        {/* Category Header */}
        <div className="mb-3 sm:mb-4">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {category.name}
          </h1>
          {category.description && (
            <p className="mt-1 max-w-2xl text-xs sm:text-sm leading-relaxed text-muted-foreground">
              {category.description}
            </p>
          )}
        </div>
      </div>

      {/* Sticky Category Navigation */}
      {categories.length > 0 && (
        <CategoryNav categories={categories} activeSlug={category.slug} />
      )}

      {/* Products list */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 mt-4 sm:mt-6">
        {products.length === 0 ? (
          <MenuEmptyState
            title={`No items currently in ${category.name}`}
            message="We are currently updating the items in this category. Please check back shortly or explore our other freshly baked categories."
            showAllLink={true}
          />
        ) : (
          <ProductGrid products={products} />
        )}
      </div>
    </div>
  );
}
