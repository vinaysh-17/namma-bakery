"use client";

import * as React from "react";
import {
  Edit2,
  Plus,
  RotateCcw,
  AlertCircle,
  X,
  ArrowLeft,
  Check,
} from "lucide-react";
import type { AdminPriceTierWithRules, AdminProduct } from "@/lib/admin/types";
import type { PriceTierRule, EggType, CakeFinish } from "@/lib/menu/types";
import {
  upsertPriceTierRuleAction,
  togglePriceTierRuleAction,
} from "@/lib/admin/actions";
import { formatPaise } from "@/lib/utils/money";

interface AdminProductPricingViewProps {
  product: AdminProduct;
  tiers: AdminPriceTierWithRules[];
  onBack: () => void;
  onActionSuccess: () => void;
}

const BASE_SUPPORTED_WEIGHTS = [
  { value: 500, label: "500 grams (0.5 kg)" },
  { value: 1000, label: "1000 grams (1.0 kg)" },
  { value: 1500, label: "1500 grams (1.5 kg)" },
  { value: 2000, label: "2000 grams (2.0 kg)" },
  { value: 2500, label: "2500 grams (2.5 kg)" },
  { value: 3000, label: "3000 grams (3.0 kg)" },
  { value: 5000, label: "5000 grams (5.0 kg)" },
];

export function AdminProductPricingView({
  product,
  tiers,
  onBack,
  onActionSuccess,
}: AdminProductPricingViewProps) {
  const [editingRule, setEditingRule] = React.useState<PriceTierRule | null>(null);
  const [isAddingRule, setIsAddingRule] = React.useState(false);
  const [priceRupees, setPriceRupees] = React.useState("");
  const [weightGrams, setWeightGrams] = React.useState("1000");
  const [eggType, setEggType] = React.useState<EggType>("EGGLESS");
  const [finish, setFinish] = React.useState<CakeFinish>("STANDARD");
  const [ruleNote, setRuleNote] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  // Locate the tier assigned to this product
  const productTier = React.useMemo(() => {
    if (!product.price_tier_id) return null;
    return tiers.find((t) => t.id === product.price_tier_id) || null;
  }, [product.price_tier_id, tiers]);

  // Pricing rules applying to this product, sorted cleanly by weight and dietary type
  const rules = React.useMemo(() => {
    if (!productTier?.price_tier_rules) return [];
    return [...productTier.price_tier_rules].sort((a, b) => {
      if (a.weight_grams !== b.weight_grams) {
        return a.weight_grams - b.weight_grams;
      }
      if (a.egg_type !== b.egg_type) {
        return a.egg_type.localeCompare(b.egg_type);
      }
      return a.finish.localeCompare(b.finish);
    });
  }, [productTier]);

  const weightOptions = React.useMemo(() => {
    const options = [...BASE_SUPPORTED_WEIGHTS];
    if (editingRule && !options.some((o) => o.value === editingRule.weight_grams)) {
      options.push({
        value: editingRule.weight_grams,
        label:
          editingRule.weight_grams >= 1000
            ? `${editingRule.weight_grams} grams (${editingRule.weight_grams / 1000} kg)`
            : `${editingRule.weight_grams} grams`,
      });
      options.sort((a, b) => a.value - b.value);
    }
    return options;
  }, [editingRule]);

  const handleOpenEdit = (rule: PriceTierRule) => {
    setEditingRule(rule);
    setIsAddingRule(false);
    setPriceRupees((rule.price_paise / 100).toString());
    setWeightGrams(rule.weight_grams.toString());
    setEggType(rule.egg_type);
    setFinish(rule.finish);
    setRuleNote(rule.note || "");
    setErrorMessage(null);
  };

  const handleOpenAdd = () => {
    if (!productTier) return;
    setEditingRule(null);
    setIsAddingRule(true);
    setPriceRupees("");
    setWeightGrams("1000");
    setEggType("EGGLESS");
    setFinish("STANDARD");
    setRuleNote("");
    setErrorMessage(null);
  };

  const handleCloseModal = () => {
    setEditingRule(null);
    setIsAddingRule(false);
    setErrorMessage(null);
  };

  const handleSubmitRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productTier) return;
    setErrorMessage(null);

    const priceNum = parseFloat(priceRupees);
    if (isNaN(priceNum) || priceNum <= 0) {
      setErrorMessage("Price must be greater than ₹0.");
      return;
    }

    const price_paise = Math.round(priceNum * 100);
    const parsedWeight = parseInt(weightGrams, 10);

    if (isNaN(parsedWeight) || parsedWeight <= 0) {
      setErrorMessage("Weight must be greater than 0g.");
      return;
    }

    setIsSubmitting(true);
    const res = await upsertPriceTierRuleAction({
      id: editingRule ? editingRule.id : undefined,
      tier_id: productTier.id,
      weight_grams: parsedWeight,
      egg_type: eggType,
      finish: finish,
      price_paise,
      is_active: editingRule ? editingRule.is_active : true,
      note: ruleNote.trim() || null,
    });
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || "Failed to save pricing rule.");
      return;
    }

    setSuccessMessage(
      editingRule ? "Pricing rule updated successfully." : "New pricing rule added."
    );
    setTimeout(() => setSuccessMessage(null), 3000);
    handleCloseModal();
    onActionSuccess();
  };

  const handleToggleActive = async (rule: PriceTierRule) => {
    const res = await togglePriceTierRuleAction(rule.id, !rule.is_active);
    if (res.success) {
      onActionSuccess();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header bar with Back Button and Product Title */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="h-8 px-2.5 rounded-sm border border-border bg-background text-foreground text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <ArrowLeft className="size-3.5" />
            <span>Back to Products</span>
          </button>
          <div>
            <h3 className="font-heading font-bold text-lg text-foreground">
              {product.name} Pricing
            </h3>
            <p className="text-xs text-muted-foreground">
              Weight, dietary, and finish pricing rules for {product.name}.
            </p>
          </div>
        </div>

        {productTier && (
          <button
            type="button"
            onClick={handleOpenAdd}
            className="h-8 px-3 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Plus className="size-3.5" />
            <span>Add Pricing Rule</span>
          </button>
        )}
      </div>

      {successMessage && (
        <div className="flex items-center gap-2 p-2.5 rounded text-xs bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
          <Check className="size-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Pricing Rules Table */}
      {!productTier ? (
        <div className="p-8 text-center rounded-sm border border-border bg-card space-y-3">
          <p className="font-semibold text-foreground text-sm">
            No pricing tier assigned to {product.name}
          </p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Tiered cakes require an assigned price tier to calculate prices by weight and dietary type.
            Please go back to the product list and click &quot;Edit&quot; on this product to assign a pricing tier.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span>Back to Products</span>
          </button>
        </div>
      ) : (
        <div className="rounded-sm border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Weight</th>
                  <th className="py-2.5 px-3 font-semibold">Dietary</th>
                  <th className="py-2.5 px-3 font-semibold">Finish / Decor</th>
                  <th className="py-2.5 px-3 font-semibold">Price (₹)</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Notes</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No pricing rules found for {product.name}. Click &quot;Add Pricing Rule&quot; above to create one.
                    </td>
                  </tr>
                ) : (
                  rules.map((rule) => (
                    <tr
                      key={rule.id}
                      className={`hover:bg-muted/20 transition-colors ${
                        !rule.is_active ? "opacity-60 bg-muted/10" : ""
                      }`}
                    >
                      <td className="py-2.5 px-3 font-bold text-foreground">
                        {rule.weight_grams >= 1000
                          ? `${rule.weight_grams / 1000} kg`
                          : `${rule.weight_grams} g`}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            rule.egg_type === "EGGLESS"
                              ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                        >
                          {rule.egg_type === "EGGLESS" ? "Eggless" : "Egg"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-foreground">
                        {rule.finish.replace("_", " ")}
                      </td>
                      <td className="py-2.5 px-3 font-heading font-bold text-sm text-foreground">
                        {formatPaise(rule.price_paise)}
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(rule)}
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                            rule.is_active
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {rule.is_active ? "Active" : "Disabled"}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground max-w-[150px] truncate">
                        {rule.note || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(rule)}
                          className="h-7 px-2.5 rounded border border-border bg-background inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                          title="Edit rule"
                        >
                          <Edit2 className="size-3 text-muted-foreground" />
                          <span>Edit</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit / Add Rule Modal */}
      {(editingRule || isAddingRule) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-4 sm:p-6 shadow-xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-heading font-bold text-base text-foreground">
                {editingRule ? `Edit Rule (${product.name})` : `Add Pricing Rule (${product.name})`}
              </h3>
              <button
                type="button"
                onClick={handleCloseModal}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted cursor-pointer"
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

            <form onSubmit={handleSubmitRule} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Weight *
                </label>
                <select
                  disabled={isSubmitting}
                  value={weightGrams}
                  onChange={(e) => setWeightGrams(e.target.value)}
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel disabled:opacity-60"
                >
                  {weightOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Dietary Type *
                  </label>
                  <select
                    disabled={isSubmitting}
                    value={eggType}
                    onChange={(e) => setEggType(e.target.value as EggType)}
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel disabled:opacity-60"
                  >
                    <option value="EGGLESS">Eggless</option>
                    <option value="EGG">Egg (Contains Egg)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Finish / Decor *
                  </label>
                  <select
                    disabled={isSubmitting}
                    value={finish}
                    onChange={(e) => setFinish(e.target.value as CakeFinish)}
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel disabled:opacity-60"
                  >
                    <option value="STANDARD">Standard</option>
                    <option value="RICE_PAPER">Rice Paper</option>
                    <option value="SHAPE_CAKE">Shape Cake</option>
                    <option value="GUM_PASTE">Gum Paste</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Price in Rupees (₹) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">
                    ₹
                  </span>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    disabled={isSubmitting}
                    value={priceRupees}
                    onChange={(e) => setPriceRupees(e.target.value)}
                    placeholder="e.g. 550"
                    className="w-full h-9 pl-7 pr-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Internal Staff Note (optional)
                </label>
                <input
                  type="text"
                  maxLength={255}
                  disabled={isSubmitting}
                  value={ruleNote}
                  onChange={(e) => setRuleNote(e.target.value)}
                  placeholder="e.g. Signature flavour base price"
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel disabled:opacity-60"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={isSubmitting}
                  className="h-9 px-3 rounded-sm border border-border bg-background text-foreground font-semibold hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 px-4 rounded-sm bg-caramel text-white font-semibold hover:bg-caramel/90 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting && <RotateCcw className="size-3.5 animate-spin" />}
                  <span>Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
