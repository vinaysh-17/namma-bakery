import type { Product } from "@/lib/menu/types";
import { ProductCard } from "./product-card";

interface ProductGridProps {
  products: Product[];
}

export function ProductGrid({ products }: ProductGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => {
        // Only the first product card (index 0) is preloaded with high priority as the primary LCP candidate.
        // All subsequent cards are lazy-loaded without explicit low fetchPriority.
        const isLcpCandidate = index === 0;

        return (
          <ProductCard
            key={product.id}
            product={product}
            preload={isLcpCandidate}
            fetchPriority={isLcpCandidate ? "high" : undefined}
            loading={isLcpCandidate ? undefined : "lazy"}
          />
        );
      })}
    </div>
  );
}
