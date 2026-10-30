"use client";

import * as React from "react";
import {
  X,
  RotateCcw,
  AlertCircle,
  Archive,
  Edit2,
  Trash2,
} from "lucide-react";
import type { AdminProduct } from "@/lib/admin/types";
import type { ProductVariant } from "@/lib/menu/types";
import {
  upsertVariantAction,
  toggleVariantAvailabilityAction,
  archiveVariantAction,
  deleteVariantAction,
} from "@/lib/admin/actions";
import { formatPaise } from "@/lib/utils/money";

interface AdminVariantsModalProps {
  product: AdminProduct;
  onClose: () => void;
  onSuccess: () => void;
}

export function AdminVariantsModal({
  product,
  onClose,
  onSuccess,
}: AdminVariantsModalProps) {
  const [variants, setVariants] = React.useState<ProductVariant[]>(
    product.product_variants ?? []
  );
  const [newLabel, setNewLabel] = React.useState("");
  const [newPriceRupees, setNewPriceRupees] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Edit variant state
  const [editingVariant, setEditingVariant] =
    React.useState<ProductVariant | null>(null);
  const [editLabel, setEditLabel] = React.useState("");
  const [editPriceRupees, setEditPriceRupees] = React.useState("");
  const [isEditing, setIsEditing] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Delete variant state
  const [variantToDelete, setVariantToDelete] =
    React.useState<ProductVariant | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleAddVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const priceNum = parseFloat(newPriceRupees);
    if (isNaN(priceNum) || priceNum <= 0) {
      setErrorMessage("Price must be greater than ₹0.");
      return;
    }

    const price_paise = Math.round(priceNum * 100);
    const nextSortOrder =
      variants.length > 0
        ? Math.max(...variants.map((v) => v.sort_order ?? 0)) + 10
        : 0;

    setIsSubmitting(true);
    const res = await upsertVariantAction({
      product_id: product.id,
      label: newLabel.trim(),
      price_paise,
      is_available: true,
      sort_order: nextSortOrder,
    });
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || "Failed to add variant.");
      return;
    }

    const createdVariant: ProductVariant = {
      id: res.data?.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())),
      product_id: product.id,
      label: newLabel.trim(),
      price_paise,
      is_available: true,
      sort_order: nextSortOrder,
      archived_at: null,
    };

    setVariants((prev) => [...prev, createdVariant]);
    setNewLabel("");
    setNewPriceRupees("");
    onSuccess();
  };

  const handleToggleAvailability = async (variant: ProductVariant) => {
    const res = await toggleVariantAvailabilityAction(
      variant.id,
      !variant.is_available
    );
    if (res.success) {
      setVariants((prev) =>
        prev.map((v) =>
          v.id === variant.id ? { ...v, is_available: !v.is_available } : v
        )
      );
      onSuccess();
    }
  };

  const handleArchive = async (variant: ProductVariant) => {
    const isArchived = Boolean(variant.archived_at);
    const res = await archiveVariantAction(variant.id, !isArchived);
    if (res.success) {
      setVariants((prev) =>
        prev.map((v) =>
          v.id === variant.id
            ? { ...v, archived_at: isArchived ? null : new Date().toISOString() }
            : v
        )
      );
      onSuccess();
    }
  };

  const handleStartEdit = (variant: ProductVariant) => {
    setEditingVariant(variant);
    setEditLabel(variant.label);
    setEditPriceRupees((variant.price_paise / 100).toString());
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVariant) return;
    setEditError(null);

    const priceNum = parseFloat(editPriceRupees);
    if (isNaN(priceNum) || priceNum <= 0) {
      setEditError("Price must be greater than ₹0.");
      return;
    }

    const price_paise = Math.round(priceNum * 100);

    setIsEditing(true);
    const res = await upsertVariantAction({
      id: editingVariant.id,
      product_id: product.id,
      label: editLabel.trim(),
      price_paise,
      is_available: editingVariant.is_available,
      sort_order: editingVariant.sort_order ?? 0,
    });
    setIsEditing(false);

    if (!res.success) {
      setEditError(res.error || "Failed to update variant.");
      return;
    }

    setVariants((prev) =>
      prev.map((v) =>
        v.id === editingVariant.id
          ? { ...v, label: editLabel.trim(), price_paise }
          : v
      )
    );
    setEditingVariant(null);
    onSuccess();
  };

  const handleConfirmDelete = async () => {
    if (!variantToDelete) return;
    setDeleteError(null);

    setIsDeleting(true);
    const res = await deleteVariantAction(variantToDelete.id);
    setIsDeleting(false);

    if (!res.success) {
      setDeleteError(res.error || "Failed to delete variant.");
      return;
    }

    setVariants((prev) => prev.filter((v) => v.id !== variantToDelete.id));
    setVariantToDelete(null);
    onSuccess();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 overflow-y-auto">
        <div className="relative w-full max-w-lg rounded-sm border border-border bg-card p-4 sm:p-6 shadow-xl space-y-4 my-auto max-h-[92vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
            <div>
              <h3 className="font-heading font-bold text-base text-foreground">
                Manage Variants
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Product:{" "}
                <span className="font-semibold text-foreground">
                  {product.name}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted cursor-pointer"
              aria-label="Close modal"
            >
              <X className="size-4" />
            </button>
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20 shrink-0">
              <AlertCircle className="size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Existing variants table */}
          <div className="rounded-sm border border-border overflow-x-auto shrink-0 max-h-56 overflow-y-auto">
            <table className="w-full text-left text-xs min-w-[340px]">
              <thead className="bg-muted/40 border-b border-border text-muted-foreground sticky top-0 z-10 backdrop-blur-xs">
                <tr>
                  <th className="py-2 px-3 font-semibold">Variant</th>
                  <th className="py-2 px-3 font-semibold">Price</th>
                  <th className="py-2 px-3 font-semibold">Status</th>
                  <th className="py-2 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {variants.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No variants defined yet. Add the first variant below.
                    </td>
                  </tr>
                ) : (
                  variants.map((v) => {
                    const isArchived = Boolean(v.archived_at);
                    return (
                      <tr
                        key={v.id}
                        className={`hover:bg-muted/20 transition-colors ${
                          isArchived ? "opacity-60 bg-muted/10" : ""
                        }`}
                      >
                        <td className="py-2.5 px-3 font-medium text-foreground">
                          {v.label}
                          {isArchived && (
                            <span className="ml-1.5 inline-block text-[10px] px-1 bg-muted text-muted-foreground rounded">
                              Archived
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-foreground whitespace-nowrap">
                          {formatPaise(v.price_paise)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleToggleAvailability(v)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                              v.is_available
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {v.is_available ? "Available" : "Sold Out"}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* 1. Archive */}
                            <button
                              type="button"
                              onClick={() => handleArchive(v)}
                              className={`size-7 sm:size-8 rounded border border-border bg-background flex items-center justify-center transition-colors cursor-pointer ${
                                isArchived
                                  ? "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400"
                                  : "text-muted-foreground hover:text-amber-800 hover:bg-amber-50 dark:hover:text-amber-300"
                              }`}
                              title={
                                isArchived ? "Restore Variant" : "Archive Variant"
                              }
                              aria-label={
                                isArchived ? "Restore Variant" : "Archive Variant"
                              }
                            >
                              {isArchived ? (
                                <RotateCcw className="size-3.5" />
                              ) : (
                                <Archive className="size-3.5" />
                              )}
                            </button>

                            {/* 2. Edit */}
                            <button
                              type="button"
                              onClick={() => handleStartEdit(v)}
                              className="size-7 sm:size-8 rounded border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                              title="Edit Variant"
                              aria-label="Edit Variant"
                            >
                              <Edit2 className="size-3.5" />
                            </button>

                            {/* 3. Delete */}
                            <button
                              type="button"
                              onClick={() => {
                                setVariantToDelete(v);
                                setDeleteError(null);
                              }}
                              className="size-7 sm:size-8 rounded border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40 transition-colors cursor-pointer"
                              title="Delete Variant"
                              aria-label="Delete Variant"
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

          {/* Add new variant form with unified bottom action row */}
          <form
            onSubmit={handleAddVariant}
            className="space-y-3 pt-3 border-t border-border shrink-0"
          >
            <p className="text-xs font-semibold text-foreground">
              Add New Variant
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-muted-foreground mb-1 font-medium">
                  Variant Label *
                </label>
                <input
                  type="text"
                  required
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Regular, Pack of 4"
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>
              <div>
                <label className="block text-muted-foreground mb-1 font-medium">
                  Price (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={newPriceRupees}
                  onChange={(e) => setNewPriceRupees(e.target.value)}
                  placeholder="e.g. 150"
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  style={{ MozAppearance: "textfield" }}
                />
              </div>
            </div>

            {/* Bottom action row: [ Close ] on left, [ Add Variant ] on right */}
            <div className="flex items-center justify-between pt-3 border-t border-border gap-3">
              <button
                type="button"
                onClick={onClose}
                className="h-8 sm:h-9 px-4 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="h-8 sm:h-9 px-4 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center"
              >
                {isSubmitting ? "Adding..." : "Add Variant"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Edit Variant Modal */}
      {editingVariant && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-sm rounded-sm border border-border bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h4 className="font-heading font-bold text-sm text-foreground">
                  Edit Variant
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Product:{" "}
                  <span className="font-semibold text-foreground">
                    {product.name}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingVariant(null)}
                disabled={isEditing}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="size-4" />
              </button>
            </div>

            {editError && (
              <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted-foreground mb-1 font-medium">
                  Variant Label *
                </label>
                <input
                  type="text"
                  required
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="e.g. Regular, Pack of 4"
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel"
                />
              </div>

              <div>
                <label className="block text-muted-foreground mb-1 font-medium">
                  Price (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editPriceRupees}
                  onChange={(e) => setEditPriceRupees(e.target.value)}
                  placeholder="e.g. 150"
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  style={{ MozAppearance: "textfield" }}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditingVariant(null)}
                  disabled={isEditing}
                  className="h-8 px-3 rounded-sm border border-border bg-background text-foreground text-xs font-semibold hover:bg-muted transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEditing}
                  className="h-8 px-4 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isEditing ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Variant Confirmation Dialog */}
      {variantToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-sm rounded-sm border border-border bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-destructive">
                <Trash2 className="size-4 shrink-0" />
                <h4 className="font-heading font-bold text-sm text-foreground">
                  Delete Variant?
                </h4>
              </div>
              <button
                type="button"
                onClick={() => {
                  setVariantToDelete(null);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="size-4" />
              </button>
            </div>

            {deleteError && (
              <div className="flex items-start gap-2 p-2.5 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{deleteError}</span>
              </div>
            )}

            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                Are you sure you want to permanently delete variant{" "}
                <strong className="text-foreground">
                  &ldquo;{variantToDelete.label}&rdquo;
                </strong>{" "}
                ({formatPaise(variantToDelete.price_paise)}) from{" "}
                <strong className="text-foreground">{product.name}</strong>?
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                This action cannot be undone. If this variant has historical customer orders, deletion will be blocked by the server to preserve order records.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setVariantToDelete(null);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="h-8 px-3 rounded-sm border border-border bg-background text-foreground text-xs font-semibold hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="h-8 px-4 rounded-sm bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isDeleting ? "Deleting..." : "Delete Variant"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
