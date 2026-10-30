"use client";

import * as React from "react";
import {
  Edit2,
  Plus,
  RotateCcw,
  AlertCircle,
  Check,
  X,
  ArrowLeft,
} from "lucide-react";
import type { AdminPriceTierWithRules, AdminProduct } from "@/lib/admin/types";
import type { PriceTierRule, EggType, CakeFinish } from "@/lib/menu/types";
import {
  upsertPriceTierRuleAction,
  togglePriceTierRuleAction,
} from "@/lib/admin/actions";
import { formatPaise } from "@/lib/utils/money";
import { formatTierName } from "@/lib/menu/utils";

interface AdminCakeTiersViewProps {
  tiers: AdminPriceTierWithRules[];
  products?: AdminProduct[];
  initialTierId?: string | null;
  onBack?: () => void;
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

export function AdminCakeTiersView({
  tiers,
  products,
  initialTierId,
  onBack,
  onActionSuccess,
}: AdminCakeTiersViewProps) {
  const [selectedTierId, setSelectedTierId] = React.useState<string>(
    initialTierId || tiers[0]?.id || ""
  );
  const [editingRule, setEditingRule] = React.useState<PriceTierRule | null>(
    null
  );
  const [isAddingRule, setIsAddingRule] = React.useState(false);
  const [priceRupees, setPriceRupees] = React.useState("");
  const [weightGrams, setWeightGrams] = React.useState("1000");
  const [eggType, setEggType] = React.useState<EggType>("EGGLESS");
  const [finish, setFinish] = React.useState<CakeFinish>("STANDARD");
  const [ruleNote, setRuleNote] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const activeTierId = selectedTierId || tiers[0]?.id || "";

  const currentTier = React.useMemo(() => {
    return tiers.find((t) => t.id === activeTierId) || tiers[0] || null;
  }, [tiers, activeTierId]);

  const associatedCakes = React.useMemo(() => {
    if (!currentTier || !products?.length) return [];
    return products.filter((p) => p.price_tier_id === currentTier.id);
  }, [currentTier, products]);

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
    if (!currentTier) return;
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
    if (!currentTier) return;
    setErrorMessage(null);

    const priceNum = parseFloat(priceRupees);
    if (isNaN(priceNum) || priceNum <= 0) {
      setErrorMessage("Price must be greater than ₹0.");
      return;
    }

    const price_paise = Math.round(priceNum * 100);
    const weight_grams = parseInt(weightGrams, 10);

    if (isNaN(weight_grams) || weight_grams <= 0) {
      setErrorMessage("Weight must be greater than 0g.");
      return;
    }

    setIsSubmitting(true);
    const res = await upsertPriceTierRuleAction({
      id: editingRule ? editingRule.id : undefined,
      tier_id: currentTier.id,
      weight_grams,
      egg_type: eggType,
      finish,
      price_paise,
      is_active: editingRule ? editingRule.is_active : true,
      note: ruleNote.trim() || null,
    });
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || "Failed to save cake price rule.");
      return;
    }

    handleCloseModal();
    setSuccessMessage("Pricing rule saved successfully.");
    setTimeout(() => {
      setSuccessMessage(null);
    }, 3500);
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
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="h-8 px-2.5 rounded-sm border border-border bg-background text-foreground text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-1.5 shrink-0"
              title="Return to products"
            >
              <ArrowLeft className="size-3.5" />
              <span>Back to Products</span>
            </button>
          )}
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">
              Cake Tier Pricing
            </h2>
            <p className="text-xs text-muted-foreground">
              Centrally manage cake prices by weight, egg/eggless preference, and decorative finish.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleOpenAdd}
          disabled={!currentTier}
          className="h-9 px-3 rounded-sm bg-caramel text-white text-xs font-semibold hover:bg-caramel/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          <span>Add Pricing Rule</span>
        </button>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="flex items-center gap-2 p-3 rounded-sm text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 animate-in fade-in">
          <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Tier Selector Pills */}
      {tiers.length > 1 && (
        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 no-scrollbar flex-wrap">
          {tiers.map((t) => {
            const isSelected = (currentTier?.id ?? selectedTierId) === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTierId(t.id)}
                className={`h-8 px-3 rounded-sm text-xs font-semibold transition-colors ${
                  isSelected
                    ? "bg-caramel text-white shadow-sm"
                    : "bg-muted text-foreground hover:bg-muted/80"
                }`}
              >
                {formatTierName(t.name)} ({t.price_tier_rules?.length ?? 0} rules)
              </button>
            );
          })}
        </div>
      )}

      {/* Current Tier Context Header */}
      {currentTier && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-sm border border-border bg-card/60 text-xs">
          <div>
            <span className="font-bold text-foreground mr-1.5">
              {formatTierName(currentTier.name)}
            </span>
            {associatedCakes.length > 0 ? (
              <span className="text-muted-foreground">
                — Applies to:{" "}
                <span className="font-medium text-foreground">
                  {associatedCakes.map((c) => c.name).join(", ")}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                ({currentTier.price_tier_rules?.length ?? 0} pricing rules)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Rules Table */}
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
              {!currentTier || (currentTier.price_tier_rules?.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    No pricing rules defined for this tier yet.
                  </td>
                </tr>
              ) : (
                currentTier.price_tier_rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className={`hover:bg-muted/20 ${
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
                        {rule.egg_type}
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
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
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
                        className="size-8 rounded border border-border bg-background inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Edit rule"
                      >
                        <Edit2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Add Rule Modal */}
      {(editingRule || isAddingRule) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-sm border border-border bg-card p-4 sm:p-6 shadow-xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-heading font-bold text-base text-foreground">
                {editingRule ? "Edit" : "Add Pricing Rule"}
              </h3>
              <button
                type="button"
                onClick={handleCloseModal}
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

            <form onSubmit={handleSubmitRule} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Weight (Grams) *
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Dietary *
                  </label>
                  <select
                    disabled={isSubmitting}
                    value={eggType}
                    onChange={(e) => setEggType(e.target.value as EggType)}
                    className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel disabled:opacity-60"
                  >
                    <option value="EGGLESS">Eggless</option>
                    <option value="EGG">Contains Egg</option>
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
                <input
                  type="number"
                  step="1"
                  required
                  min={1}
                  disabled={isSubmitting}
                  value={priceRupees}
                  onChange={(e) => setPriceRupees(e.target.value)}
                  placeholder="e.g. 750"
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-caramel disabled:opacity-60"
                />
                <span className="text-[11px] text-muted-foreground mt-0.5 block">
                  Automatically converted to integer paise in the database.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Internal Note (Optional)
                </label>
                <input
                  type="text"
                  disabled={isSubmitting}
                  value={ruleNote}
                  onChange={(e) => setRuleNote(e.target.value)}
                  placeholder="e.g. Confirmed with kitchen head"
                  maxLength={255}
                  className="w-full h-9 px-3 rounded-sm border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-caramel disabled:opacity-60"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={handleCloseModal}
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
