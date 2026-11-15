"use client";

import * as React from "react";
import {
  Plus,
  Search,
  Edit2,
  Archive,
  RotateCcw,
  Layers,
  AlertCircle,
  Eye,
  EyeOff,
  X,
  Trash2,
  MoreVertical,
  Upload,
  Image as ImageIcon,
  Check,
} from "lucide-react";
import type {
  AdminProduct,
  AdminCategory,
  AdminPriceTierWithRules,
} from "@/lib/admin/types";
import type { ProductImage } from "@/lib/menu/types";
import {
  upsertProductAction,
  toggleProductAvailabilityAction,
  archiveProductAction,
  deleteProductAction,
  upsertCategoryAction,
  toggleCategoryVisibilityAction,
  archiveCategoryAction,
  deleteCategoryAction,
  uploadProductImageAction,
  deleteProductImageAction,
} from "@/lib/admin/actions";
import { resolvePrimaryProductImage } from "@/lib/menu/product-images";
import { AdminVariantsModal } from "./admin-variants-modal";
import { AdminProductPricingView } from "./admin-product-pricing-view";
import {
  generateSlug,
  type AdminProductInput,
  type AdminCategoryInput,
} from "@/lib/admin/validation";

interface AdminCatalogViewProps {
  categories: AdminCategory[];
  products: AdminProduct[];
  priceTiers: AdminPriceTierWithRules[];
  onActionSuccess: () => void;
}

export function AdminCatalogView({
  categories,
  products,
  priceTiers,
  onActionSuccess,
}: AdminCatalogViewProps) {
  // Local categories state for immediate responsive additions/removals
  const [prevCategories, setPrevCategories] = React.useState(categories);
  const [localCategories, setLocalCategories] = React.useState<AdminCategory[]>(categories);

  if (categories !== prevCategories) {
    setPrevCategories(categories);
    setLocalCategories(categories);
  }

  // Local products state for immediate optimistic availability toggling and deletions
  const [prevProducts, setPrevProducts] = React.useState(products);
  const [localProducts, setLocalProducts] = React.useState<AdminProduct[]>(products);

  if (products !== prevProducts) {
    setPrevProducts(products);
    setLocalProducts(products);
  }

  // Availability toggle loading tracker
  const [updatingAvailabilityIds, setUpdatingAvailabilityIds] = React.useState<Set<string>>(
    new Set()
  );

  // Navigation & Category state
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string>(
    categories[0]?.id || ""
  );
  const [viewMode, setViewMode] = React.useState<"PRODUCTS" | "PRICING">("PRODUCTS");
  const [selectedPricingProduct, setSelectedPricingProduct] = React.useState<AdminProduct | null>(null);

  // Category Archive Confirmation modal state
  const [categoryToRemove, setCategoryToRemove] = React.useState<AdminCategory | null>(null);
  const [isRemovingCategory, setIsRemovingCategory] = React.useState(false);

  // Category Permanent Deletion modal state
  const [categoryToDelete, setCategoryToDelete] = React.useState<AdminCategory | null>(null);
  const [isDeletingCategory, setIsDeletingCategory] = React.useState(false);
  const [categoryDeleteError, setCategoryDeleteError] = React.useState<string | null>(null);

  // Dynamically resolve product count for category deletion validation
  const categoryToDeleteProductCount = React.useMemo(() => {
    if (!categoryToDelete) return 0;
    const countInLocal = localProducts.filter((p) => p.category_id === categoryToDelete.id).length;
    if (countInLocal > 0) return countInLocal;
    const recorded = Number(categoryToDelete.product_count);
    return !isNaN(recorded) && recorded > 0 ? recorded : 0;
  }, [categoryToDelete, localProducts]);

  const isCategoryDeletionBlocked = categoryToDeleteProductCount > 0;

  // Category More Actions dropdown state
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = React.useState(false);
  const categoryMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isCategoryMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        categoryMenuRef.current &&
        !categoryMenuRef.current.contains(e.target as Node)
      ) {
        setIsCategoryMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsCategoryMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCategoryMenuOpen]);

  // Product Permanent Deletion modal state
  const [productToDelete, setProductToDelete] = React.useState<AdminProduct | null>(null);
  const [isDeletingProduct, setIsDeletingProduct] = React.useState(false);
  const [productDeleteError, setProductDeleteError] = React.useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = React.useState<
    "ALL" | "AVAILABLE" | "SOLD_OUT" | "ARCHIVED"
  >("ALL");

  // Category Modal state
  const [isCreatingCategory, setIsCreatingCategory] = React.useState(false);
  const [editingCategory, setEditingCategory] = React.useState<AdminCategory | null>(null);
  const [categoryFormData, setCategoryFormData] = React.useState<AdminCategoryInput>({
    name: "",
    name_kn: "",
    slug: "",
    description: "",
    sort_order: 0,
    is_visible: true,
  });

  // Product Modal state
  const [isCreatingProduct, setIsCreatingProduct] = React.useState(false);
  const [editingProduct, setEditingProduct] = React.useState<AdminProduct | null>(null);
  const [variantsModalProduct, setVariantsModalProduct] = React.useState<AdminProduct | null>(null);
  const [productFormData, setProductFormData] = React.useState<AdminProductInput>({
    category_id: categories[0]?.id || "",
    name: "",
    name_kn: "",
    slug: "",
    description: "",
    kind: "SIMPLE",
    price_tier_id: null,
    is_available: true,
    orderable_online: true,
    requires_confirmation: true,
    is_featured: false,
    is_best_seller: false,
    is_new_arrival: false,
    is_seasonal: false,
    lead_time_minutes: 240,
    sort_order: 0,
  });

  // Shared form submission state
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Form custom state (#85, #90)
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = React.useState(false);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imageAltText, setImageAltText] = React.useState("");
  const [isUploadingImage, setIsUploadingImage] = React.useState(false);
  const [isDeletingImage, setIsDeletingImage] = React.useState(false);
  const [imageError, setImageError] = React.useState<string | null>(null);
  const [imageSuccess, setImageSuccess] = React.useState<string | null>(null);

  // Active product synchronization (#H-1):
  // Derives the latest product entity from updated products prop when modal is open,
  // ensuring image upload / deletion updates thumbnail, status badge, and resolved URL
  // immediately without resetting productFormData.
  const activeEditingProduct = React.useMemo(() => {
    if (!editingProduct) return null;
    return products.find((p) => p.id === editingProduct.id) ?? editingProduct;
  }, [editingProduct, products]);

  // Active Category resolution
  const activeCategoryId = selectedCategoryId || localCategories[0]?.id || "";
  const currentCategory = React.useMemo(() => {
    return localCategories.find((c) => c.id === activeCategoryId) || localCategories[0] || null;
  }, [localCategories, activeCategoryId]);

  // Is this category containing tiered cakes (e.g. Cakes)?
  const isCakeCategory = React.useMemo(() => {
    if (!currentCategory) return false;
    return (
      currentCategory.slug === "cakes" ||
      localProducts.some((p) => p.category_id === currentCategory.id && p.kind === "TIERED_CAKE")
    );
  }, [currentCategory, localProducts]);

  // Map tier IDs to their active pricing rules count
  const tierRuleCountMap = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const tier of priceTiers) {
      map.set(tier.id, tier.price_tier_rules?.length ?? 0);
    }
    return map;
  }, [priceTiers]);

  // Products belonging to the active category, alphabetically sorted by product display name
  const categoryProducts = React.useMemo(() => {
    if (!currentCategory) return [];
    const prods = localProducts.filter((p) => p.category_id === currentCategory.id);
    return [...prods].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [localProducts, currentCategory]);

  // Filtered products for display
  const filteredProducts = React.useMemo(() => {
    return categoryProducts.filter((prod) => {
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = prod.name.toLowerCase().includes(query);
        const matchesKn = prod.name_kn?.toLowerCase().includes(query);
        const matchesSlug = prod.slug.toLowerCase().includes(query);
        if (!matchesName && !matchesKn && !matchesSlug) return false;
      }

      // Status filter
      const isArchived = Boolean(prod.archived_at);
      if (statusFilter === "AVAILABLE") return prod.is_available && !isArchived;
      if (statusFilter === "SOLD_OUT") return !prod.is_available && !isArchived;
      if (statusFilter === "ARCHIVED") return isArchived;

      return true;
    });
  }, [categoryProducts, searchQuery, statusFilter]);

  // ---------------------------------------------------------------- CATEGORY HANDLERS
  const handleOpenCreateCategory = () => {
    setCategoryFormData({
      name: "",
      name_kn: "",
      slug: "",
      description: "",
      sort_order: localCategories.length * 10,
      is_visible: true,
    });
    setErrorMessage(null);
    setIsCreatingCategory(true);
    setEditingCategory(null);
  };

  const handleOpenEditCategory = (cat: AdminCategory) => {
    setCategoryFormData({
      id: cat.id,
      name: cat.name,
      name_kn: cat.name_kn || "",
      slug: cat.slug,
      description: cat.description || "",
      sort_order: cat.sort_order,
      is_visible: cat.is_visible,
    });
    setErrorMessage(null);
    setEditingCategory(cat);
    setIsCreatingCategory(false);
  };

  const handleCloseCategoryModal = () => {
    setIsCreatingCategory(false);
    setEditingCategory(null);
    setErrorMessage(null);
  };

  const handleSubmitCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const finalSlug =
      categoryFormData.slug && categoryFormData.slug.trim()
        ? categoryFormData.slug.trim()
        : generateSlug(categoryFormData.name);

    const submissionData = {
      ...categoryFormData,
      slug: finalSlug,
    };

    const res = await upsertCategoryAction(submissionData);
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || "Failed to save category.");
      return;
    }

    if (res.data) {
      const savedId = res.data.id;
      const newCategory: AdminCategory = {
        id: savedId,
        name: categoryFormData.name,
        name_kn: categoryFormData.name_kn || null,
        slug: finalSlug,
        description: categoryFormData.description || null,
        image_path: categoryFormData.image_path || null,
        sort_order: categoryFormData.sort_order,
        is_visible: categoryFormData.is_visible,
        archived_at: null,
        created_at: new Date().toISOString(),
        product_count: 0,
      };

      setLocalCategories((prev) => {
        const exists = prev.some((c) => c.id === savedId);
        if (exists) {
          return prev.map((c) =>
            c.id === savedId ? { ...c, ...newCategory, product_count: c.product_count } : c
          );
        }
        return [...prev, newCategory];
      });
      setSelectedCategoryId(savedId);
    }

    handleCloseCategoryModal();
    onActionSuccess();
  };

  const handleToggleCategoryVisibility = async (cat: AdminCategory) => {
    const res = await toggleCategoryVisibilityAction(cat.id, !cat.is_visible);
    if (res.success) {
      setLocalCategories((prev) =>
        prev.map((c) => (c.id === cat.id ? { ...c, is_visible: !cat.is_visible } : c))
      );
      onActionSuccess();
    } else {
      setErrorMessage(res.error || `Failed to update visibility for category "${cat.name}".`);
    }
  };

  const handleRequestRemoveCategory = (cat: AdminCategory) => {
    setCategoryToRemove(cat);
  };

  const handleConfirmArchiveCategory = async () => {
    if (!categoryToRemove) return;
    setIsRemovingCategory(true);
    const catId = categoryToRemove.id;
    const res = await archiveCategoryAction(catId, true);
    setIsRemovingCategory(false);

    if (res.success) {
      setLocalCategories((prev) =>
        prev.map((c) =>
          c.id === catId ? { ...c, archived_at: new Date().toISOString() } : c
        )
      );
      setCategoryToRemove(null);
      // Switch to first remaining active category if the current one was archived
      const remainingActive = localCategories.filter(
        (c) => c.id !== catId && !c.archived_at
      );
      if (remainingActive.length > 0) {
        setSelectedCategoryId(remainingActive[0].id);
      }
      onActionSuccess();
    } else {
      setErrorMessage(res.error || "Failed to remove category.");
    }
  };

  const handleRestoreCategory = async (cat: AdminCategory) => {
    setIsSubmitting(true);
    const res = await archiveCategoryAction(cat.id, false);
    setIsSubmitting(false);

    if (res.success) {
      setLocalCategories((prev) =>
        prev.map((c) => (c.id === cat.id ? { ...c, archived_at: null } : c))
      );
      onActionSuccess();
    } else {
      setErrorMessage(res.error || "Failed to restore category.");
    }
  };

  // ---------------------------------------------------------------- PRODUCT HANDLERS
  const handleOpenCreateProduct = () => {
    const isCake = isCakeCategory;
    setProductFormData({
      category_id: currentCategory?.id || categories[0]?.id || "",
      name: "",
      name_kn: "",
      slug: "",
      description: "",
      kind: isCake ? "TIERED_CAKE" : "SIMPLE",
      price_tier_id: isCake ? priceTiers[0]?.id || null : null,
      is_available: true,
      orderable_online: true,
      requires_confirmation: isCake ? true : false,
      is_featured: false,
      is_best_seller: false,
      is_new_arrival: false,
      is_seasonal: false,
      lead_time_minutes: isCake ? 240 : 60,
      sort_order: categoryProducts.length * 10,
    });
    setIsSlugManuallyEdited(false);
    setImageFile(null);
    setImageAltText("");
    setImageError(null);
    setImageSuccess(null);
    setErrorMessage(null);
    setIsCreatingProduct(true);
    setEditingProduct(null);
  };

  const handleOpenEditProduct = (prod: AdminProduct) => {
    setProductFormData({
      id: prod.id,
      category_id: prod.category_id,
      name: prod.name,
      name_kn: prod.name_kn || "",
      slug: prod.slug,
      description: prod.description || "",
      kind: prod.kind,
      price_tier_id: prod.price_tier_id || null,
      is_available: prod.is_available,
      orderable_online: prod.orderable_online,
      requires_confirmation: prod.requires_confirmation,
      is_featured: prod.is_featured,
      is_best_seller: prod.is_best_seller,
      is_new_arrival: prod.is_new_arrival,
      is_seasonal: prod.is_seasonal,
      lead_time_minutes: prod.lead_time_minutes,
      sort_order: prod.sort_order,
    });
    setIsSlugManuallyEdited(true);
    setImageFile(null);
    setImageAltText("");
    setImageError(null);
    setImageSuccess(null);
    setErrorMessage(null);
    setEditingProduct(prod);
    setIsCreatingProduct(false);
  };

  const handleCloseProductModal = () => {
    setIsCreatingProduct(false);
    setEditingProduct(null);
    setIsSlugManuallyEdited(false);
    setImageFile(null);
    setImageAltText("");
    setImageError(null);
    setImageSuccess(null);
    setErrorMessage(null);
  };

  const handleUploadProductImage = async (productId: string) => {
    if (!imageFile) return;
    setIsUploadingImage(true);
    setImageError(null);
    setImageSuccess(null);

    const fd = new FormData();
    fd.append("productId", productId);
    fd.append("file", imageFile);
    fd.append("altText", imageAltText.trim() || productFormData.name || "Product photo");
    fd.append("isPrimary", "true");

    const res = await uploadProductImageAction(fd);
    setIsUploadingImage(false);

    if (res.success && res.data) {
      setImageFile(null);
      setImageAltText("");
      setImageSuccess("Product photo uploaded successfully!");
      setTimeout(() => setImageSuccess(null), 3000);

      // Optimistically update editingProduct state with new primary image
      // while keeping productFormData completely intact (#H-1)
      const uploadedImg: ProductImage = {
        id: res.data.id,
        product_id: productId,
        storage_path: res.data.storage_path,
        alt_text: imageAltText.trim() || productFormData.name || "Product photo",
        is_primary: true,
        sort_order: 0,
      };
      setEditingProduct((prev) => {
        if (!prev) return null;
        const remaining = (prev.product_images || []).map((img) => ({
          ...img,
          is_primary: false,
        }));
        return {
          ...prev,
          product_images: [uploadedImg, ...remaining],
        };
      });

      onActionSuccess();
    } else {
      setImageError(res.error || "Failed to upload image.");
    }
  };

  const handleDeleteProductImage = async (imageId: string) => {
    if (!window.confirm("Are you sure you want to remove this custom photo?")) return;
    setIsDeletingImage(true);
    setImageError(null);
    setImageSuccess(null);

    const res = await deleteProductImageAction(imageId);
    setIsDeletingImage(false);

    if (res.success) {
      setImageSuccess("Custom photo removed.");
      setTimeout(() => setImageSuccess(null), 3000);

      // Optimistically update editingProduct state by filtering out deleted image
      // and promoting the next remaining image to primary if deleted image was primary (#H-1)
      setEditingProduct((prev) => {
        if (!prev || !prev.product_images) return prev;
        const wasPrimary = prev.product_images.find((img) => img.id === imageId)?.is_primary;
        const filtered = prev.product_images.filter((img) => img.id !== imageId);
        if (wasPrimary && filtered.length > 0) {
          filtered[0] = { ...filtered[0], is_primary: true };
        }
        return {
          ...prev,
          product_images: filtered,
        };
      });

      onActionSuccess();
    } else {
      setImageError(res.error || "Failed to delete photo.");
    }
  };

  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const finalSlug =
      productFormData.slug && productFormData.slug.trim()
        ? productFormData.slug.trim()
        : generateSlug(productFormData.name);

    if (productFormData.kind === "TIERED_CAKE" && !productFormData.price_tier_id) {
      setIsSubmitting(false);
      setErrorMessage("Please select a price tier for this tiered cake.");
      return;
    }

    const submissionData = {
      ...productFormData,
      slug: finalSlug,
      price_tier_id:
        productFormData.kind === "TIERED_CAKE"
          ? productFormData.price_tier_id || priceTiers[0]?.id || null
          : null,
    };

    const res = await upsertProductAction(submissionData);
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || "Failed to save product.");
      return;
    }

    handleCloseProductModal();
    onActionSuccess();
  };

  const handleToggleProductAvailability = async (prod: AdminProduct) => {
    if (updatingAvailabilityIds.has(prod.id)) return;
    const prevAvailable = prod.is_available;
    const nextAvailable = !prevAvailable;

    // Optimistic UI update
    setUpdatingAvailabilityIds((prev) => new Set(prev).add(prod.id));
    setLocalProducts((prev) =>
      prev.map((p) => (p.id === prod.id ? { ...p, is_available: nextAvailable } : p))
    );

    const res = await toggleProductAvailabilityAction(prod.id, nextAvailable);

    setUpdatingAvailabilityIds((prev) => {
      const next = new Set(prev);
      next.delete(prod.id);
      return next;
    });

    if (!res.success) {
      // Revert optimistic update
      setLocalProducts((prev) =>
        prev.map((p) => (p.id === prod.id ? { ...p, is_available: prevAvailable } : p))
      );
      setErrorMessage(res.error || `Failed to update availability for "${prod.name}".`);
    } else {
      onActionSuccess();
    }
  };

  const handleToggleProductArchive = async (prod: AdminProduct) => {
    const isArchived = Boolean(prod.archived_at);
    const res = await archiveProductAction(prod.id, !isArchived);
    if (res.success) {
      setLocalProducts((prev) =>
        prev.map((p) =>
          p.id === prod.id
            ? { ...p, archived_at: !isArchived ? new Date().toISOString() : null }
            : p
        )
      );
      onActionSuccess();
    } else {
      setErrorMessage(res.error || "Failed to update product archive status.");
    }
  };

  const handleConfirmDeleteCategory = async () => {
    if (!categoryToDelete) return;
    setIsDeletingCategory(true);
    setCategoryDeleteError(null);

    const catId = categoryToDelete.id;
    const res = await deleteCategoryAction(catId);
    setIsDeletingCategory(false);

    if (res.success) {
      setLocalCategories((prev) => prev.filter((c) => c.id !== catId));
      setCategoryToDelete(null);
      // Switch to first remaining active category
      const remaining = localCategories.filter((c) => c.id !== catId);
      setSelectedCategoryId(remaining.length > 0 ? remaining[0].id : "");
      onActionSuccess();
    } else {
      setCategoryDeleteError(res.error || "Failed to delete category.");
    }
  };

  const handleConfirmDeleteProduct = async () => {
    if (!productToDelete) return;
    setIsDeletingProduct(true);
    setProductDeleteError(null);

    const prodId = productToDelete.id;
    const catId = productToDelete.category_id;
    const res = await deleteProductAction(prodId);
    setIsDeletingProduct(false);

    if (res.success) {
      setLocalProducts((prev) => prev.filter((p) => p.id !== prodId));
      setLocalCategories((prev) =>
        prev.map((c) =>
          c.id === catId ? { ...c, product_count: Math.max(0, (c.product_count ?? 1) - 1) } : c
        )
      );
      setProductToDelete(null);
      onActionSuccess();
    } else {
      setProductDeleteError(res.error || "Failed to delete product.");
    }
  };

  // Open pricing editor for a specific cake product
  const handleOpenPricingForProduct = (prod: AdminProduct) => {
    setSelectedPricingProduct(prod);
    setViewMode("PRICING");
  };

  return (
    <div className="space-y-5">
      {/* Top-Level Quick-Action Error Banner (#86) */}
      {errorMessage && !isCreatingCategory && !editingCategory && !isCreatingProduct && !editingProduct && (
        <div
          role="alert"
          className="flex items-center justify-between p-3 rounded-sm text-xs bg-destructive/10 text-destructive border border-destructive/20 animate-in fade-in duration-150"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span className="font-semibold">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 rounded hover:bg-destructive/10 text-destructive cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Primary Category Selector & Action Toolbar (Sticky while scrolling through catalog) */}
      <div className="sticky top-[117px] z-10 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2.5 bg-background/95 backdrop-blur-md border-b border-border/80 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Category Tabs (left) */}
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar py-0.5 min-w-0 flex-1">
            {localCategories.map((cat) => {
              const isSelected = currentCategory?.id === cat.id;
              const isArchived = Boolean(cat.archived_at);

              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategoryId(cat.id);
                    setViewMode("PRODUCTS");
                    setSelectedPricingProduct(null);
                  }}
                  className={`h-9 px-3 rounded-sm text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer shrink-0 ${
                    isSelected
                      ? "bg-caramel text-white shadow-sm"
                      : "bg-card border border-border text-foreground hover:bg-muted"
                  } ${isArchived ? "opacity-60" : ""}`}
                >
                  <span>{cat.name}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {cat.product_count ?? 0}
                  </span>
                  {!cat.is_visible && (
                    <span title="Hidden from menu">
                      <EyeOff className="size-3 text-muted-foreground" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Category Actions (right): Add Category */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleOpenCreateCategory}
              className="h-9 px-3 rounded-sm border border-border bg-background text-foreground text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="size-3.5" />
              <span>Add Category</span>
            </button>
          </div>
        </div>
      </div>

      {/* Selected Category Information & Controls Banner */}
      {currentCategory && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-sm border border-border bg-card text-xs">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-heading font-bold text-base text-foreground">
                {currentCategory.name}
              </span>
              {currentCategory.archived_at && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  Archived
                </span>
              )}
              {!currentCategory.is_visible && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground">
                  Hidden from public menu
                </span>
              )}
            </div>
            {currentCategory.description && (
              <p className="text-muted-foreground">{currentCategory.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Visibility Toggle */}
            <button
              type="button"
              onClick={() => handleToggleCategoryVisibility(currentCategory)}
              className="h-8 px-2.5 rounded-sm border border-border bg-background text-foreground hover:bg-muted transition-colors flex items-center gap-1.5 cursor-pointer text-xs font-medium"
              title={
                currentCategory.is_visible
                  ? "Hide category from public storefront menu"
                  : "Make category visible on public storefront menu"
              }
            >
              {currentCategory.is_visible ? (
                <>
                  <Eye className="size-3.5 text-emerald-600" />
                  <span>Visible on Menu</span>
                </>
              ) : (
                <>
                  <EyeOff className="size-3.5 text-muted-foreground" />
                  <span>Hidden from Menu</span>
                </>
              )}
            </button>

            {/* Compact Category Actions Menu [⋮] */}
            <div className="relative" ref={categoryMenuRef}>
              <button
                type="button"
                onClick={() => setIsCategoryMenuOpen((prev) => !prev)}
                className={`size-8 rounded-sm border border-border bg-background flex items-center justify-center transition-colors cursor-pointer ${
                  isCategoryMenuOpen
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
                title="More category actions"
                aria-label="More category actions"
                aria-expanded={isCategoryMenuOpen}
              >
                <MoreVertical className="size-4" />
              </button>

              {isCategoryMenuOpen && (
                <div className="absolute right-0 mt-1 w-44 rounded-sm border border-border bg-card p-1 shadow-lg z-20 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCategoryMenuOpen(false);
                      handleOpenEditCategory(currentCategory);
                    }}
                    className="w-full h-8 px-2.5 rounded-xs flex items-center gap-2 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer text-left"
                  >
                    <Edit2 className="size-3.5 text-muted-foreground" />
                    <span>Edit Category</span>
                  </button>

                  {currentCategory.archived_at ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCategoryMenuOpen(false);
                        handleRestoreCategory(currentCategory);
                      }}
                      className="w-full h-8 px-2.5 rounded-xs flex items-center gap-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer text-left"
                    >
                      <RotateCcw className="size-3.5" />
                      <span>Restore Category</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCategoryMenuOpen(false);
                        handleRequestRemoveCategory(currentCategory);
                      }}
                      className="w-full h-8 px-2.5 rounded-xs flex items-center gap-2 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer text-left"
                    >
                      <Archive className="size-3.5 text-muted-foreground" />
                      <span>Archive Category</span>
                    </button>
                  )}

                  <div className="border-t border-border my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setIsCategoryMenuOpen(false);
                      setCategoryToDelete(currentCategory);
                      setCategoryDeleteError(null);
                    }}
                    className="w-full h-8 px-2.5 rounded-xs flex items-center gap-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer text-left"
                  >
                    <Trash2 className="size-3.5" />
                    <span>Delete Category</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Body: Switch between Products Table or Product-Specific Pricing */}
      {viewMode === "PRICING" && selectedPricingProduct ? (
        <div className="rounded-sm border border-border bg-card p-4 sm:p-5">
          <AdminProductPricingView
            product={selectedPricingProduct}
            tiers={priceTiers}
            products={products}
            onBack={() => {
              setSelectedPricingProduct(null);
              setViewMode("PRODUCTS");
            }}
            onActionSuccess={onActionSuccess}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Filters & Actions for Products */}
          <div className="rounded-sm border border-border bg-card p-3 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 text-xs">
            <div className="relative flex-1">
              <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search in ${currentCategory?.name || "products"}...`}
                className="w-full h-8 pl-8 pr-8 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
              >
                <option value="ALL">All Statuses</option>
                <option value="AVAILABLE">Available Now</option>
                <option value="SOLD_OUT">Marked Sold Out</option>
                <option value="ARCHIVED">Archived</option>
              </select>

              <button
                type="button"
                onClick={handleOpenCreateProduct}
                className="h-8 px-3 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors flex items-center gap-1.5 shrink-0"
              >
                <Plus className="size-3.5" />
                <span>Add Product</span>
              </button>
            </div>
          </div>

          {/* Products Table (Cleaned up: No "Flags", No "Order" column) */}
          <div className="rounded-sm border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Product</th>
                    <th className="py-2.5 px-3 font-semibold w-48 whitespace-nowrap">Pricing</th>
                    <th className="py-2.5 px-3 font-semibold w-40 whitespace-nowrap">Availability</th>
                    <th className="py-2.5 px-3 font-semibold w-36 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-muted-foreground">
                        <p className="font-semibold text-foreground">No products found</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {searchQuery
                            ? `No items match "${searchQuery}".`
                            : "No products added to this category yet."}
                        </p>
                        <button
                          type="button"
                          onClick={handleOpenCreateProduct}
                          className="inline-flex items-center gap-1.5 mt-3 h-8 px-3 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors"
                        >
                          <Plus className="size-3.5" />
                          <span>Add Product to {currentCategory?.name}</span>
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((prod) => {
                      const isArchived = Boolean(prod.archived_at);
                      const isTiered = prod.kind === "TIERED_CAKE";

                      return (
                        <tr
                          key={prod.id}
                          className={`hover:bg-muted/20 ${
                            isArchived ? "opacity-60 bg-muted/10" : ""
                          }`}
                        >
                          {/* Product Column */}
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2.5">
                              {(() => {
                                const resolved = resolvePrimaryProductImage(prod);
                                return resolved.url ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img
                                    src={resolved.url}
                                    alt={resolved.alt}
                                    className="size-9 rounded-sm object-cover border border-border shrink-0 bg-muted/20"
                                  />
                                ) : (
                                  <div
                                    className="size-9 rounded-sm border border-dashed border-border bg-muted/30 flex items-center justify-center shrink-0 text-muted-foreground"
                                    title="No photo"
                                  >
                                    <ImageIcon className="size-4 text-muted-foreground/60" />
                                  </div>
                                );
                              })()}
                              <div className="min-w-0">
                                <div className="font-semibold text-foreground truncate">
                                  {prod.name}
                                  {isArchived && (
                                    <span className="ml-1.5 inline-block px-1.5 py-0.2 rounded text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                      Archived
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  /{prod.slug}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Kind / Pricing Column */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {isTiered ? (
                              <button
                                type="button"
                                onClick={() => handleOpenPricingForProduct(prod)}
                                className="text-xs text-caramel hover:underline font-semibold cursor-pointer whitespace-nowrap"
                                title={`Manage pricing rules for ${prod.name}`}
                              >
                                Manage Pricing ({prod.price_tier_id ? (tierRuleCountMap.get(prod.price_tier_id) ?? 0) : 0})
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setVariantsModalProduct(prod)}
                                className="text-xs text-caramel hover:underline font-semibold cursor-pointer whitespace-nowrap"
                                title={`Manage variants for ${prod.name}`}
                              >
                                Manage Variants ({prod.product_variants?.length ?? 0})
                              </button>
                            )}
                          </td>

                          {/* Availability Column */}
                          <td className="py-2.5 px-3">
                            {(() => {
                              const isUpdating = updatingAvailabilityIds.has(prod.id);
                              const isOn = prod.is_available;
                              return (
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={isOn}
                                  aria-label={`${prod.name} availability: ${isOn ? "Available" : "Unavailable"}`}
                                  disabled={isUpdating}
                                  onClick={() => handleToggleProductAvailability(prod)}
                                  className={`group inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel disabled:cursor-not-allowed disabled:opacity-60 border ${
                                    isOn
                                      ? "bg-emerald-50/80 border-emerald-200/80 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800/60 dark:text-emerald-200 hover:bg-emerald-100/70"
                                      : "bg-muted/40 border-border text-muted-foreground hover:bg-muted/70"
                                  }`}
                                  title={`Click to set ${prod.name} as ${isOn ? "Unavailable" : "Available"}`}
                                >
                                  {/* Toggle Track & Thumb */}
                                  <span
                                    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
                                      isOn
                                        ? "bg-emerald-700 dark:bg-emerald-600"
                                        : "bg-muted-foreground/30 dark:bg-muted-foreground/40"
                                    }`}
                                  >
                                    <span
                                      className={`inline-block size-3 rounded-full bg-white shadow-xs transition-transform duration-200 ease-in-out ${
                                        isOn ? "translate-x-3.5" : "translate-x-0.5"
                                      }`}
                                    />
                                  </span>

                                  {/* State Label & Spinner */}
                                  <div className="flex items-center gap-1.5 select-none">
                                    {isUpdating ? (
                                      <>
                                        <RotateCcw className="size-3 animate-spin text-caramel" />
                                        <span className="text-[11px] font-medium text-muted-foreground">Saving...</span>
                                      </>
                                    ) : (
                                      <span
                                        className={`text-[11px] font-medium ${
                                          isOn
                                            ? "text-emerald-900 dark:text-emerald-200"
                                            : "text-muted-foreground"
                                        }`}
                                      >
                                        {isOn ? "Available" : "Unavailable"}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })()}
                          </td>

                          {/* Actions Column: [Pricing] [Edit] [Archive] [Delete] */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* 1. Pricing / Variants */}
                              {isTiered ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenPricingForProduct(prod)}
                                  className="size-8 rounded border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                  title={`Manage Pricing (${prod.price_tier_id ? (tierRuleCountMap.get(prod.price_tier_id) ?? 0) : 0}) for ${prod.name}`}
                                >
                                  <Layers className="size-3.5 text-caramel" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setVariantsModalProduct(prod)}
                                  className="size-8 rounded border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                  title={`Manage Variants (${prod.product_variants?.length ?? 0}) for ${prod.name}`}
                                >
                                  <Layers className="size-3.5 text-caramel" />
                                </button>
                              )}

                              {/* 2. Edit */}
                              <button
                                type="button"
                                onClick={() => handleOpenEditProduct(prod)}
                                className="size-8 rounded border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                title={`Edit ${prod.name}`}
                                aria-label={`Edit ${prod.name}`}
                              >
                                <Edit2 className="size-3.5" />
                              </button>

                              {/* 3. Archive / Restore */}
                              <button
                                type="button"
                                onClick={() => handleToggleProductArchive(prod)}
                                className={`size-8 rounded border border-border bg-background flex items-center justify-center transition-colors cursor-pointer ${
                                  isArchived
                                    ? "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400"
                                    : "text-muted-foreground hover:text-amber-800 hover:bg-amber-50 dark:hover:text-amber-300"
                                }`}
                                title={isArchived ? `Restore ${prod.name}` : `Archive ${prod.name}`}
                                aria-label={isArchived ? `Restore ${prod.name}` : `Archive ${prod.name}`}
                              >
                                {isArchived ? (
                                  <RotateCcw className="size-3.5" />
                                ) : (
                                  <Archive className="size-3.5" />
                                )}
                              </button>

                              {/* 4. Delete */}
                              <button
                                type="button"
                                onClick={() => {
                                  setProductToDelete(prod);
                                  setProductDeleteError(null);
                                }}
                                className="size-8 rounded border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40 transition-colors cursor-pointer"
                                title={`Delete ${prod.name}`}
                                aria-label={`Delete ${prod.name}`}
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- CREATE / EDIT CATEGORY MODAL */}
      {(isCreatingCategory || editingCategory) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-4 sm:p-6 shadow-xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-heading font-bold text-base text-foreground">
                {isCreatingCategory
                  ? "Add New Category"
                  : `Edit "${editingCategory?.name}"`}
              </h3>
              <button
                type="button"
                onClick={handleCloseCategoryModal}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                aria-label="Close dialog"
              >
                <X className="size-4" />
              </button>
            </div>

            {errorMessage && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmitCategory} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Category Name (English) *
                </label>
                <input
                  type="text"
                  required
                  value={categoryFormData.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setCategoryFormData((prev) => ({
                      ...prev,
                      name,
                      slug: isCreatingCategory ? generateSlug(name) : (prev.slug || generateSlug(name)),
                    }));
                  }}
                  placeholder="e.g. Cakes, Breads, Sandwiches"
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Category Name (Kannada)
                </label>
                <input
                  type="text"
                  value={categoryFormData.name_kn || ""}
                  onChange={(e) =>
                    setCategoryFormData((prev) => ({
                      ...prev,
                      name_kn: e.target.value,
                    }))
                  }
                  placeholder="e.g. ಕೇಕ್"
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel font-kannada"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={categoryFormData.description || ""}
                  onChange={(e) =>
                    setCategoryFormData((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Brief description for customer menu..."
                  className="w-full p-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel resize-none"
                />
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={categoryFormData.is_visible}
                    onChange={(e) =>
                      setCategoryFormData((prev) => ({
                        ...prev,
                        is_visible: e.target.checked,
                      }))
                    }
                    className="size-4 rounded border-border text-caramel focus:ring-caramel accent-caramel"
                  />
                  <span className="font-semibold text-foreground">
                    Visible on public customer menu
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={handleCloseCategoryModal}
                  disabled={isSubmitting}
                  className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 px-4 rounded-sm bg-caramel text-white font-semibold hover:bg-caramel/90 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting && <RotateCcw className="size-3.5 animate-spin" />}
                  <span>Save Category</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- CREATE / EDIT PRODUCT MODAL */}
      {(isCreatingProduct || editingProduct) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm border border-border bg-card p-4 sm:p-6 shadow-xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-heading font-bold text-base text-foreground">
                {isCreatingProduct
                  ? "Add New Product"
                  : `Edit "${editingProduct?.name}"`}
              </h3>
              <button
                type="button"
                onClick={handleCloseProductModal}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                aria-label="Close dialog"
              >
                <X className="size-4" />
              </button>
            </div>

            {errorMessage && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmitProduct} className="space-y-4 text-xs">
              {/* Category, Product Kind & Price Tier (#66) */}
              <div
                className={
                  productFormData.kind === "TIERED_CAKE"
                    ? "grid grid-cols-1 sm:grid-cols-3 gap-3"
                    : "grid grid-cols-1 sm:grid-cols-2 gap-3"
                }
              >
                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Category *
                  </label>
                  <select
                    value={productFormData.category_id}
                    onChange={(e) =>
                      setProductFormData((prev) => ({
                        ...prev,
                        category_id: e.target.value,
                      }))
                    }
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Product Kind *
                  </label>
                  <select
                    value={productFormData.kind}
                    onChange={(e) => {
                      const kind = e.target.value as "SIMPLE" | "TIERED_CAKE";
                      setProductFormData((prev) => ({
                        ...prev,
                        kind,
                        price_tier_id:
                          kind === "TIERED_CAKE"
                            ? prev.price_tier_id || priceTiers[0]?.id || null
                            : null,
                        lead_time_minutes:
                          kind === "TIERED_CAKE"
                            ? prev.lead_time_minutes === 60
                              ? 240
                              : prev.lead_time_minutes
                            : prev.lead_time_minutes === 240
                              ? 60
                              : prev.lead_time_minutes,
                        requires_confirmation: kind === "TIERED_CAKE" ? true : false,
                      }));
                    }}
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                  >
                    <option value="SIMPLE">Simple (Counter items, savouries)</option>
                    <option value="TIERED_CAKE">Tiered Cake (Multi-weight pricing)</option>
                  </select>
                </div>

                {productFormData.kind === "TIERED_CAKE" && (
                  <div>
                    <label className="block font-semibold text-foreground mb-1">
                      Price Tier *
                    </label>
                    <select
                      required
                      value={productFormData.price_tier_id || ""}
                      onChange={(e) =>
                        setProductFormData((prev) => ({
                          ...prev,
                          price_tier_id: e.target.value || null,
                        }))
                      }
                      className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                    >
                      <option value="">Select a price tier...</option>
                      {priceTiers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.price_tier_rules?.length ?? 0} rules)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Names & Slug (#85) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Product Name (English) *
                  </label>
                  <input
                    type="text"
                    required
                    value={productFormData.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setProductFormData((prev) => ({
                        ...prev,
                        name,
                        slug: isSlugManuallyEdited ? prev.slug : generateSlug(name),
                      }));
                    }}
                    placeholder="e.g. Vanilla Cake, Paneer Sandwich"
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Product Name (Kannada)
                  </label>
                  <input
                    type="text"
                    value={productFormData.name_kn || ""}
                    onChange={(e) =>
                      setProductFormData((prev) => ({
                        ...prev,
                        name_kn: e.target.value,
                      }))
                    }
                    placeholder="e.g. ವೆನಿಲ್ಲಾ ಕೇಕ್"
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel font-kannada"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    URL Slug *
                  </label>
                  <input
                    type="text"
                    required
                    value={productFormData.slug}
                    onChange={(e) => {
                      setIsSlugManuallyEdited(true);
                      setProductFormData((prev) => ({
                        ...prev,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                      }));
                    }}
                    placeholder="e.g. vanilla-cake"
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel font-mono text-xs"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={productFormData.description || ""}
                  onChange={(e) =>
                    setProductFormData((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Product description for customers..."
                  className="w-full p-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel resize-none"
                />
              </div>

              {/* Marketing Badges & Flags (preserved in model & form) */}
              <div className="pt-2 border-t border-border">
                <label className="block font-semibold text-foreground mb-2">
                  Marketing Badges
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={productFormData.is_featured}
                      onChange={(e) =>
                        setProductFormData((prev) => ({
                          ...prev,
                          is_featured: e.target.checked,
                        }))
                      }
                      className="size-4 rounded border-border text-caramel focus:ring-caramel accent-caramel"
                    />
                    <span>Featured</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={productFormData.is_best_seller}
                      onChange={(e) =>
                        setProductFormData((prev) => ({
                          ...prev,
                          is_best_seller: e.target.checked,
                        }))
                      }
                      className="size-4 rounded border-border text-caramel focus:ring-caramel accent-caramel"
                    />
                    <span>Best Seller</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={productFormData.is_new_arrival}
                      onChange={(e) =>
                        setProductFormData((prev) => ({
                          ...prev,
                          is_new_arrival: e.target.checked,
                        }))
                      }
                      className="size-4 rounded border-border text-caramel focus:ring-caramel accent-caramel"
                    />
                    <span>New Arrival</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={productFormData.is_seasonal}
                      onChange={(e) =>
                        setProductFormData((prev) => ({
                          ...prev,
                          is_seasonal: e.target.checked,
                        }))
                      }
                      className="size-4 rounded border-border text-caramel focus:ring-caramel accent-caramel"
                    />
                    <span>Seasonal</span>
                  </label>
                </div>
              </div>

              {/* Operations, Ordering, Lead Time & Confirmation Controls (#71) */}
              <div className="pt-2 border-t border-border space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={productFormData.is_available}
                      onChange={(e) =>
                        setProductFormData((prev) => ({
                          ...prev,
                          is_available: e.target.checked,
                        }))
                      }
                      className="size-4 rounded border-border text-caramel focus:ring-caramel accent-caramel"
                    />
                    <span>Available in Store Today</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={productFormData.orderable_online}
                      onChange={(e) =>
                        setProductFormData((prev) => ({
                          ...prev,
                          orderable_online: e.target.checked,
                        }))
                      }
                      className="size-4 rounded border-border text-caramel focus:ring-caramel accent-caramel"
                    />
                    <span>Orderable Online</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/60">
                  <div>
                    <label className="block font-semibold text-foreground mb-1">
                      Lead Time (Minutes) *
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        required
                        value={productFormData.lead_time_minutes}
                        onChange={(e) =>
                          setProductFormData((prev) => ({
                            ...prev,
                            lead_time_minutes: Math.max(0, parseInt(e.target.value) || 0),
                          }))
                        }
                        className="w-28 h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                      />
                      <span className="text-muted-foreground text-xs">minutes</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {[
                        { label: "30m", val: 30 },
                        { label: "60m (1h)", val: 60 },
                        { label: "120m (2h)", val: 120 },
                        { label: "240m (4h)", val: 240 },
                        { label: "480m (8h)", val: 480 },
                      ].map((preset) => (
                        <button
                          key={preset.val}
                          type="button"
                          onClick={() =>
                            setProductFormData((prev) => ({
                              ...prev,
                              lead_time_minutes: preset.val,
                            }))
                          }
                          className={`px-2 py-0.5 rounded text-[10px] font-medium border cursor-pointer ${
                            productFormData.lead_time_minutes === preset.val
                              ? "bg-caramel text-white border-caramel"
                              : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Earliest pickup notice required for cart items containing this product.
                    </p>
                  </div>

                  <div className="flex flex-col justify-start">
                    <label className="block font-semibold text-foreground mb-1">
                      Confirmation Setting
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer mt-1">
                      <input
                        type="checkbox"
                        checked={productFormData.requires_confirmation}
                        onChange={(e) =>
                          setProductFormData((prev) => ({
                            ...prev,
                            requires_confirmation: e.target.checked,
                          }))
                        }
                        className="size-4 rounded border-border text-caramel focus:ring-caramel accent-caramel"
                      />
                      <span className="font-medium text-foreground">
                        Requires Staff Review / Confirmation
                      </span>
                    </label>
                    <p className="text-[11px] text-muted-foreground ml-6 mt-1">
                      If checked, orders containing this item require staff review before being confirmed.
                    </p>
                  </div>
                </div>
              </div>

              {/* Product Photo Management (#90, #H-1) */}
              {activeEditingProduct && (
                <div className="pt-3 border-t border-border space-y-2.5">
                  <label className="block font-semibold text-foreground">
                    Product Photo
                  </label>
                  {imageError && (
                    <div className="flex items-center gap-2 p-2 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span>{imageError}</span>
                    </div>
                  )}
                  {imageSuccess && (
                    <div className="flex items-center gap-2 p-2 rounded text-xs bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
                      <Check className="size-3.5 shrink-0" />
                      <span>{imageSuccess}</span>
                    </div>
                  )}

                  <div className="flex items-start gap-3 p-3 rounded-sm border border-border bg-muted/20">
                    {(() => {
                      const resolved = resolvePrimaryProductImage(activeEditingProduct);
                      const customImage =
                        activeEditingProduct.product_images?.find((img) => img.is_primary) ??
                        activeEditingProduct.product_images?.[0];
                      return (
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {resolved.url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={resolved.url}
                              alt={resolved.alt}
                              className="size-16 rounded-sm object-cover border border-border shrink-0 bg-background"
                            />
                          ) : (
                            <div className="size-16 rounded-sm border border-dashed border-border bg-muted/50 flex flex-col items-center justify-center shrink-0 text-muted-foreground">
                              <ImageIcon className="size-6 text-muted-foreground/60" />
                              <span className="text-[9px] mt-0.5">No Photo</span>
                            </div>
                          )}

                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              {customImage ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                  Custom Photo (Uploaded)
                                </span>
                              ) : resolved.isLocal ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                                  Stock Catalog Photo
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground">
                                  No Photo
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {customImage
                                ? "Custom photo in Supabase Storage. Upload a new photo to replace."
                                : "Upload a photo (PNG, JPEG, WebP up to 5MB) to customize this product's image."}
                            </p>
                            {customImage && (
                              <button
                                type="button"
                                disabled={isDeletingImage}
                                onClick={() => handleDeleteProductImage(customImage.id)}
                                className="text-[11px] text-destructive hover:underline font-semibold cursor-pointer disabled:opacity-50"
                              >
                                {isDeletingImage ? "Removing photo..." : "Remove Custom Photo"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* File upload input */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setImageFile(f);
                        setImageError(null);
                      }}
                      className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-xs file:border-0 file:text-xs file:font-semibold file:bg-muted file:text-foreground hover:file:bg-muted/80 cursor-pointer"
                    />
                    {imageFile && (
                      <button
                        type="button"
                        disabled={isUploadingImage}
                        onClick={() => handleUploadProductImage(activeEditingProduct.id)}
                        className="h-8 px-3 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
                      >
                        {isUploadingImage ? (
                          <RotateCcw className="size-3.5 animate-spin" />
                        ) : (
                          <Upload className="size-3.5" />
                        )}
                        <span>Upload Photo</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={handleCloseProductModal}
                  disabled={isSubmitting}
                  className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 px-4 rounded-sm bg-caramel text-white font-semibold hover:bg-caramel/90 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting && <RotateCcw className="size-3.5 animate-spin" />}
                  <span>Save Product</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- VARIANTS MODAL (FOR SIMPLE PRODUCTS) */}
      {variantsModalProduct && (
        <AdminVariantsModal
          product={variantsModalProduct}
          onClose={() => {
            setVariantsModalProduct(null);
            onActionSuccess();
          }}
          onSuccess={onActionSuccess}
        />
      )}

      {/* ---------------------------------------------------------------- CATEGORY REMOVAL / ARCHIVE CONFIRMATION MODAL */}
      {categoryToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-4 sm:p-6 shadow-xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="size-5 shrink-0" />
                <h3 className="font-heading font-bold text-base text-foreground">
                  Remove / Archive Category
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCategoryToRemove(null)}
                disabled={isRemovingCategory}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-muted-foreground">
              <p>
                Are you sure you want to remove / archive{" "}
                <strong className="text-foreground">{categoryToRemove.name}</strong>?
              </p>

              {categoryToRemove.product_count && categoryToRemove.product_count > 0 ? (
                <div className="p-3 rounded-sm bg-amber-500/10 border border-amber-500/20 text-foreground space-y-1.5">
                  <p className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <span>⚠️ Contains {categoryToRemove.product_count} product(s)</span>
                  </p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    This category and its products will be safely hidden from the public customer menu. All product details, pricing tiers, and past order records will remain completely intact in the database. No products will be orphaned.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  This category will be hidden from the public storefront menu. You can restore it at any time.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setCategoryToRemove(null)}
                disabled={isRemovingCategory}
                className="h-8 px-3 rounded-sm border border-border bg-background text-foreground text-xs font-semibold hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmArchiveCategory}
                disabled={isRemovingCategory}
                className="h-8 px-3.5 rounded-sm bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isRemovingCategory && <RotateCcw className="size-3.5 animate-spin" />}
                <span>Confirm Archive</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- CATEGORY PERMANENT DELETION MODAL */}
      {categoryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-4 sm:p-6 shadow-xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-destructive">
                <Trash2 className="size-5 shrink-0" />
                <h3 className="font-heading font-bold text-base text-foreground">
                  Delete Category?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCategoryToDelete(null);
                  setCategoryDeleteError(null);
                }}
                disabled={isDeletingCategory}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="size-4" />
              </button>
            </div>

            {categoryDeleteError && (
              <div className="flex items-start gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{categoryDeleteError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs text-muted-foreground">
              <p>
                Are you sure you want to permanently delete{" "}
                <strong className="text-foreground">&ldquo;{categoryToDelete.name}&rdquo;</strong>?
              </p>

              {isCategoryDeletionBlocked ? (
                <div className="p-3 rounded-sm bg-destructive/10 border border-destructive/20 text-foreground space-y-2">
                  <p className="font-semibold text-destructive flex items-center gap-1.5">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>Deletion blocked: contains {categoryToDeleteProductCount} product(s)</span>
                  </p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    This category contains {categoryToDeleteProductCount} product(s). Remove or reassign those products before deleting the category.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  This action cannot be undone. The category will be permanently removed from the database.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setCategoryToDelete(null);
                  setCategoryDeleteError(null);
                }}
                disabled={isDeletingCategory}
                className="h-8 px-3 rounded-sm border border-border bg-background text-foreground text-xs font-semibold hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              {!isCategoryDeletionBlocked && (
                <button
                  type="button"
                  onClick={handleConfirmDeleteCategory}
                  disabled={isDeletingCategory}
                  className="h-8 px-3.5 rounded-sm bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isDeletingCategory && <RotateCcw className="size-3.5 animate-spin" />}
                  <span>Delete Category</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- PRODUCT PERMANENT DELETION MODAL */}
      {productToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-4 sm:p-6 shadow-xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-destructive">
                <Trash2 className="size-5 shrink-0" />
                <h3 className="font-heading font-bold text-base text-foreground">
                  Delete Product?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProductToDelete(null);
                  setProductDeleteError(null);
                }}
                disabled={isDeletingProduct}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="size-4" />
              </button>
            </div>

            {productDeleteError && (
              <div className="flex items-start gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{productDeleteError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs text-muted-foreground">
              <p>
                Are you sure you want to permanently delete{" "}
                <strong className="text-foreground">&ldquo;{productToDelete.name}&rdquo;</strong>? This action cannot be undone.
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Note: If this product is referenced in historical customer orders, deletion will be blocked by the server to preserve financial records (use Archive instead).
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setProductToDelete(null);
                  setProductDeleteError(null);
                }}
                disabled={isDeletingProduct}
                className="h-8 px-3 rounded-sm border border-border bg-background text-foreground text-xs font-semibold hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteProduct}
                disabled={isDeletingProduct}
                className="h-8 px-3.5 rounded-sm bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeletingProduct && <RotateCcw className="size-3.5 animate-spin" />}
                <span>Delete Product</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
