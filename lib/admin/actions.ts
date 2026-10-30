"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdminSession } from "./auth";
import {
  adminCategorySchema,
  adminProductSchema,
  adminVariantSchema,
  adminPriceTierRuleSchema,
  adminStoreSettingsSchema,
  adminPauseStoreSchema,
  adminSpecialClosureSchema,
  adminBusinessHourSchema,
  adminStaffRoleSchema,
  createStaffMemberSchema,
  updateStaffMemberSchema,
  removeStaffMemberSchema,
  type AdminCategoryInput,
  type AdminProductInput,
  type AdminVariantInput,
  type AdminPriceTierRuleInput,
  type AdminStoreSettingsInput,
  type AdminPauseStoreInput,
  type AdminSpecialClosureInput,
  type AdminBusinessHourInput,
  type AdminStaffRoleInput,
  type CreateStaffMemberInput,
  type UpdateStaffMemberInput,
  type RemoveStaffMemberInput,
} from "./validation";

export interface AdminActionResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

// ---------------------------------------------------------------- CATEGORIES

export async function upsertCategoryAction(
  rawInput: AdminCategoryInput
): Promise<AdminActionResult<{ id: string }>> {
  try {
    await assertAdminSession();

    const parsed = adminCategorySchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid category data.",
      };
    }

    const { id, ...data } = parsed.data;
    const supabase = await createClient();

    if (id && id.trim().length > 0) {
      const { error } = await supabase
        .from("categories")
        .update({
          name: data.name,
          name_kn: data.name_kn || null,
          slug: data.slug,
          description: data.description || null,
          image_path: data.image_path || null,
          sort_order: data.sort_order,
          is_visible: data.is_visible,
        })
        .eq("id", id);

      if (error) {
        if (error.code === "23505") {
          return {
            success: false,
            error: `A category with the URL slug "${data.slug}" already exists.`,
          };
        }
        return { success: false, error: error.message };
      }
      revalidatePath("/admin");
      revalidatePath("/menu");
      return { success: true, data: { id } };
    } else {
      const { data: inserted, error } = await supabase
        .from("categories")
        .insert({
          name: data.name,
          name_kn: data.name_kn || null,
          slug: data.slug,
          description: data.description || null,
          image_path: data.image_path || null,
          sort_order: data.sort_order,
          is_visible: data.is_visible,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        if (error?.code === "23505") {
          return {
            success: false,
            error: `A category with the URL slug "${data.slug}" already exists.`,
          };
        }
        return { success: false, error: error?.message || "Failed to create category." };
      }
      revalidatePath("/admin");
      revalidatePath("/menu");
      return { success: true, data: { id: inserted.id } };
    }
  } catch (err) {
    console.error("[upsertCategoryAction] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save category.",
    };
  }
}

export async function toggleCategoryVisibilityAction(
  categoryId: string,
  isVisible: boolean
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();
    const supabase = await createClient();

    const { error } = await supabase
      .from("categories")
      .update({ is_visible: isVisible })
      .eq("id", categoryId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle category visibility.",
    };
  }
}

export async function archiveCategoryAction(
  categoryId: string,
  isArchived: boolean
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();
    const supabase = await createClient();

    const { error } = await supabase
      .from("categories")
      .update({ archived_at: isArchived ? new Date().toISOString() : null })
      .eq("id", categoryId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update category archive status.",
    };
  }
}

export async function deleteCategoryAction(
  categoryId: string
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();

    if (!categoryId || typeof categoryId !== "string" || categoryId.trim().length === 0) {
      return { success: false, error: "Invalid category ID." };
    }

    const supabase = await createClient();

    // Verify whether this category contains any products (active or archived)
    const { count: productCount, error: countError } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", categoryId);

    if (countError) {
      return { success: false, error: countError.message };
    }

    if (productCount && productCount > 0) {
      return {
        success: false,
        error: `This category contains ${productCount} product(s). Remove or reassign those products before deleting the category.`,
      };
    }

    // Safe deletion: category has 0 products
    const { error: deleteError } = await supabase
      .from("categories")
      .delete()
      .eq("id", categoryId);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete category.",
    };
  }
}

// ---------------------------------------------------------------- PRODUCTS

export async function upsertProductAction(
  rawInput: AdminProductInput
): Promise<AdminActionResult<{ id: string }>> {
  try {
    await assertAdminSession();

    const parsed = adminProductSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid product data.",
      };
    }

    const { id, ...data } = parsed.data;
    const supabase = await createClient();

    const payload = {
      category_id: data.category_id,
      name: data.name,
      name_kn: data.name_kn || null,
      slug: data.slug,
      description: data.description || null,
      kind: data.kind,
      price_tier_id: data.kind === "TIERED_CAKE" ? data.price_tier_id : null,
      is_available: data.is_available,
      orderable_online: data.orderable_online,
      requires_confirmation: data.requires_confirmation,
      is_featured: data.is_featured,
      is_best_seller: data.is_best_seller,
      is_new_arrival: data.is_new_arrival,
      is_seasonal: data.is_seasonal,
      lead_time_minutes: data.lead_time_minutes,
      sort_order: data.sort_order,
    };

    if (id) {
      const { error } = await supabase.from("products").update(payload).eq("id", id);
      if (error) {
        return { success: false, error: error.message };
      }
      revalidatePath("/admin");
      revalidatePath("/menu");
      return { success: true, data: { id } };
    } else {
      const { data: inserted, error } = await supabase
        .from("products")
        .insert(payload)
        .select("id")
        .single();

      if (error || !inserted) {
        return { success: false, error: error?.message || "Failed to create product." };
      }
      revalidatePath("/admin");
      revalidatePath("/menu");
      return { success: true, data: { id: inserted.id } };
    }
  } catch (err) {
    console.error("[upsertProductAction] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save product.",
    };
  }
}

export async function toggleProductAvailabilityAction(
  productId: string,
  isAvailable: boolean
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();
    const supabase = await createClient();

    // Call stored RPC or update directly
    const { error: rpcError } = await supabase.rpc("set_product_availability", {
      p_product_id: productId,
      p_available: isAvailable,
    });

    if (rpcError) {
      const { error } = await supabase
        .from("products")
        .update({ is_available: isAvailable })
        .eq("id", productId);
      if (error) return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle product availability.",
    };
  }
}

export async function archiveProductAction(
  productId: string,
  isArchived: boolean
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();
    const supabase = await createClient();

    const { error } = await supabase
      .from("products")
      .update({ archived_at: isArchived ? new Date().toISOString() : null })
      .eq("id", productId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update product archive status.",
    };
  }
}

export async function deleteProductAction(
  productId: string
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();

    if (!productId || typeof productId !== "string" || productId.trim().length === 0) {
      return { success: false, error: "Invalid product ID." };
    }

    const supabase = await createClient();

    // Check if product is referenced in existing customer orders
    const { count: orderItemCount, error: countError } = await supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId);

    if (countError) {
      return { success: false, error: countError.message };
    }

    if (orderItemCount && orderItemCount > 0) {
      return {
        success: false,
        error: `Cannot permanently delete this product because it is referenced in ${orderItemCount} historical order(s). Please archive it instead to keep customer order records intact.`,
      };
    }

    // Safely delete product (product_variants and product_images cascade automatically)
    const { error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", productId);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete product.",
    };
  }
}

// ---------------------------------------------------------------- VARIANTS

export async function upsertVariantAction(
  rawInput: AdminVariantInput
): Promise<AdminActionResult<{ id: string }>> {
  try {
    await assertAdminSession();

    const parsed = adminVariantSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid variant data.",
      };
    }

    const { id, ...data } = parsed.data;
    const supabase = await createClient();

    if (id) {
      const { error } = await supabase
        .from("product_variants")
        .update({
          label: data.label,
          price_paise: data.price_paise,
          is_available: data.is_available,
          sort_order: data.sort_order,
        })
        .eq("id", id);

      if (error) return { success: false, error: error.message };
      revalidatePath("/admin");
      revalidatePath("/menu");
      return { success: true, data: { id } };
    } else {
      const { data: inserted, error } = await supabase
        .from("product_variants")
        .insert({
          product_id: data.product_id,
          label: data.label,
          price_paise: data.price_paise,
          is_available: data.is_available,
          sort_order: data.sort_order,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        return { success: false, error: error?.message || "Failed to add variant." };
      }
      revalidatePath("/admin");
      revalidatePath("/menu");
      return { success: true, data: { id: inserted.id } };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save variant.",
    };
  }
}

export async function toggleVariantAvailabilityAction(
  variantId: string,
  isAvailable: boolean
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();
    const supabase = await createClient();

    const { error: rpcError } = await supabase.rpc("set_variant_availability", {
      p_variant_id: variantId,
      p_available: isAvailable,
    });

    if (rpcError) {
      const { error } = await supabase
        .from("product_variants")
        .update({ is_available: isAvailable })
        .eq("id", variantId);
      if (error) return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle variant availability.",
    };
  }
}

export async function archiveVariantAction(
  variantId: string,
  isArchived: boolean
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();
    const supabase = await createClient();

    const { error } = await supabase
      .from("product_variants")
      .update({ archived_at: isArchived ? new Date().toISOString() : null })
      .eq("id", variantId);

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update variant archive status.",
    };
  }
}

export async function deleteVariantAction(
  variantId: string
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();
    const supabase = await createClient();

    // Check if variant is referenced in historical customer orders
    const { count: orderItemCount, error: countError } = await supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("variant_id", variantId);

    if (countError) {
      return { success: false, error: countError.message };
    }

    if (orderItemCount && orderItemCount > 0) {
      return {
        success: false,
        error: `Cannot permanently delete this variant because it is referenced in ${orderItemCount} historical order(s). Please archive it instead to keep customer order records intact.`,
      };
    }

    const { error: deleteError } = await supabase
      .from("product_variants")
      .delete()
      .eq("id", variantId);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete variant.",
    };
  }
}

// ---------------------------------------------------------------- CAKE TIER RULES

export async function upsertPriceTierRuleAction(
  rawInput: AdminPriceTierRuleInput
): Promise<AdminActionResult<{ id: string }>> {
  try {
    await assertAdminSession();

    const parsed = adminPriceTierRuleSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid price tier rule data.",
      };
    }

    const { id, ...data } = parsed.data;
    const supabase = await createClient();

    if (id) {
      const { error } = await supabase
        .from("price_tier_rules")
        .update({
          weight_grams: data.weight_grams,
          egg_type: data.egg_type,
          finish: data.finish,
          price_paise: data.price_paise,
          is_active: data.is_active,
          note: data.note || null,
        })
        .eq("id", id);

      if (error) {
        if (error.code === "23505") {
          return {
            success: false,
            error:
              "A pricing rule with this weight, dietary type, and finish already exists in this tier.",
          };
        }
        return { success: false, error: error.message };
      }
      revalidatePath("/admin");
      revalidatePath("/menu");
      return { success: true, data: { id } };
    } else {
      const { data: inserted, error } = await supabase
        .from("price_tier_rules")
        .insert({
          tier_id: data.tier_id,
          weight_grams: data.weight_grams,
          egg_type: data.egg_type,
          finish: data.finish,
          price_paise: data.price_paise,
          is_active: data.is_active,
          note: data.note || null,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        if (error?.code === "23505") {
          return {
            success: false,
            error:
              "A pricing rule with this weight, dietary type, and finish already exists in this tier.",
          };
        }
        return { success: false, error: error?.message || "Failed to add price rule." };
      }
      revalidatePath("/admin");
      revalidatePath("/menu");
      return { success: true, data: { id: inserted.id } };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save cake price rule.",
    };
  }
}

export async function togglePriceTierRuleAction(
  ruleId: string,
  isActive: boolean
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();
    const supabase = await createClient();

    const { error } = await supabase
      .from("price_tier_rules")
      .update({ is_active: isActive })
      .eq("id", ruleId);

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin");
    revalidatePath("/menu");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle rule active state.",
    };
  }
}

// ---------------------------------------------------------------- STORE OPERATIONS

export async function updateStoreSettingsAction(
  rawInput: AdminStoreSettingsInput
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();

    const parsed = adminStoreSettingsSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid store settings data.",
      };
    }

    const { location_id, ...settings } = parsed.data;
    const supabase = await createClient();

    const { error } = await supabase
      .from("store_settings")
      .update(settings)
      .eq("location_id", location_id);

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin");
    revalidatePath("/checkout");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update store settings.",
    };
  }
}

export async function toggleStorePauseAction(
  rawInput: AdminPauseStoreInput
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();

    const parsed = adminPauseStoreSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid store pause data.",
      };
    }

    const { location_id, is_paused, paused_until, pause_message } = parsed.data;
    const supabase = await createClient();

    const p_until = is_paused ? (paused_until || new Date(Date.now() + 24 * 3600 * 1000).toISOString()) : null;
    const p_message = is_paused ? (pause_message || "Online ordering is temporarily paused.") : null;

    const { error: rpcError } = await supabase.rpc("set_orders_pause", {
      p_location_id: location_id,
      p_until,
      p_message,
    });

    if (rpcError) {
      const { error } = await supabase
        .from("store_settings")
        .update({
          orders_paused_until: p_until,
          pause_message: p_message,
        })
        .eq("location_id", location_id);

      if (error) return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    revalidatePath("/menu");
    revalidatePath("/checkout");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle store pause state.",
    };
  }
}

export async function addSpecialClosureAction(
  rawInput: AdminSpecialClosureInput
): Promise<AdminActionResult<{ id: string }>> {
  try {
    await assertAdminSession();

    const parsed = adminSpecialClosureSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid closure date.",
      };
    }

    const supabase = await createClient();
    const { data: inserted, error } = await supabase
      .from("special_closures")
      .insert({
        location_id: parsed.data.location_id,
        closure_date: parsed.data.closure_date,
        reason: parsed.data.reason || "Scheduled bakery closure",
      })
      .select("id")
      .single();

    if (error || !inserted) {
      return {
        success: false,
        error: error?.message || "Failed to add special closure date.",
      };
    }

    revalidatePath("/admin");
    revalidatePath("/checkout");
    return { success: true, data: { id: inserted.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add special closure date.",
    };
  }
}

export async function removeSpecialClosureAction(
  closureId: string
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();
    const supabase = await createClient();

    const { error } = await supabase
      .from("special_closures")
      .delete()
      .eq("id", closureId);

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin");
    revalidatePath("/checkout");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove closure date.",
    };
  }
}

export const deleteSpecialClosureAction = removeSpecialClosureAction;

export async function updateSpecialClosureAction(
  rawInput: AdminSpecialClosureInput & { id: string }
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();

    const parsed = adminSpecialClosureSchema.safeParse(rawInput);
    if (!parsed.success || !rawInput.id) {
      return {
        success: false,
        error: parsed.error?.issues[0]?.message ?? "Invalid closure data or ID.",
      };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("special_closures")
      .update({
        closure_date: parsed.data.closure_date,
        reason: parsed.data.reason?.trim() || "Scheduled bakery closure",
      })
      .eq("id", rawInput.id);

    if (error) {
      return {
        success: false,
        error: error.message.includes("unique") || error.code === "23505"
          ? "A closure date already exists for this date."
          : error.message || "Failed to update closure date.",
      };
    }

    revalidatePath("/admin");
    revalidatePath("/checkout");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update closure date.",
    };
  }
}

// ---------------------------------------------------------------- BUSINESS HOURS

export async function updateBusinessHourAction(
  rawInput: AdminBusinessHourInput
): Promise<AdminActionResult<{ id: string }>> {
  try {
    await assertAdminSession();

    const parsed = adminBusinessHourSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid operating hours.",
      };
    }

    const { id, location_id, weekday, opens, closes } = parsed.data;
    const opensFormatted = opens.length === 5 ? `${opens}:00` : opens;
    const closesFormatted = closes.length === 5 ? `${closes}:00` : closes;

    const supabase = await createClient();

    if (id) {
      const { error } = await supabase
        .from("business_hours")
        .update({
          opens: opensFormatted,
          closes: closesFormatted,
        })
        .eq("id", id);

      if (error) {
        return { success: false, error: error.message || "Failed to update operating hours." };
      }
      revalidatePath("/admin");
      revalidatePath("/checkout");
      return { success: true, data: { id } };
    }

    // If no ID provided (e.g. day was archived/deleted previously), check if record exists
    const { data: existing } = await supabase
      .from("business_hours")
      .select("id")
      .eq("location_id", location_id)
      .eq("weekday", weekday)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("business_hours")
        .update({
          opens: opensFormatted,
          closes: closesFormatted,
        })
        .eq("id", existing.id);

      if (error) {
        return { success: false, error: error.message || "Failed to update operating hours." };
      }
      revalidatePath("/admin");
      revalidatePath("/checkout");
      return { success: true, data: { id: existing.id } };
    }

    const { data: inserted, error } = await supabase
      .from("business_hours")
      .insert({
        location_id,
        weekday,
        opens: opensFormatted,
        closes: closesFormatted,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      return { success: false, error: error?.message || "Failed to save operating hours." };
    }

    revalidatePath("/admin");
    revalidatePath("/checkout");
    return { success: true, data: { id: inserted.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update operating hours.",
    };
  }
}

export async function archiveBusinessHourAction(
  hourId: string
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();

    if (!hourId) {
      return { success: false, error: "Invalid business hour ID." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("business_hours")
      .delete()
      .eq("id", hourId);

    if (error) {
      return { success: false, error: error.message || "Failed to archive operating hours." };
    }

    revalidatePath("/admin");
    revalidatePath("/checkout");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to archive operating hours.",
    };
  }
}

export async function unarchiveBusinessHourAction(
  rawInput: { location_id: string; weekday: number; opens?: string; closes?: string }
): Promise<AdminActionResult<{ id: string }>> {
  try {
    await assertAdminSession();

    const { location_id, weekday } = rawInput;
    if (typeof weekday !== "number" || weekday < 0 || weekday > 6 || !location_id) {
      return { success: false, error: "Invalid weekday or location." };
    }

    const supabase = await createClient();

    // Check if an active record already exists to prevent duplicate records
    const { data: existing } = await supabase
      .from("business_hours")
      .select("id, opens, closes")
      .eq("location_id", location_id)
      .eq("weekday", weekday)
      .maybeSingle();

    if (existing) {
      return { success: true, data: { id: existing.id } };
    }

    // Determine opening and closing times to restore
    let restoreOpens = rawInput.opens;
    let restoreCloses = rawInput.closes;

    if (!restoreOpens || !restoreCloses) {
      // Look up previous record from audit_log if available
      try {
        const { data: auditEntries } = await supabase
          .from("audit_log")
          .select("old_data")
          .eq("table_name", "business_hours")
          .order("performed_at", { ascending: false })
          .limit(20);

        if (auditEntries) {
          const match = auditEntries.find((entry) => {
            const data = entry.old_data as Record<string, unknown> | null;
            return (
              data &&
              data.location_id === location_id &&
              Number(data.weekday) === weekday
            );
          });
          if (match && match.old_data) {
            const old = match.old_data as Record<string, string>;
            if (old.opens && old.closes) {
              restoreOpens = old.opens.slice(0, 5);
              restoreCloses = old.closes.slice(0, 5);
            }
          }
        }
      } catch (auditErr) {
        console.warn("[unarchiveBusinessHourAction] Could not fetch audit log:", auditErr);
      }
    }

    const finalOpens = restoreOpens
      ? (restoreOpens.length === 5 ? `${restoreOpens}:00` : restoreOpens)
      : "10:00:00";
    const finalCloses = restoreCloses
      ? (restoreCloses.length === 5 ? `${restoreCloses}:00` : restoreCloses)
      : "21:30:00";

    const { data: inserted, error } = await supabase
      .from("business_hours")
      .insert({
        location_id,
        weekday,
        opens: finalOpens,
        closes: finalCloses,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      return { success: false, error: error?.message || "Failed to unarchive operating hours." };
    }

    revalidatePath("/admin");
    revalidatePath("/checkout");
    return { success: true, data: { id: inserted.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to unarchive operating hours.",
    };
  }
}

// ---------------------------------------------------------------- STAFF MANAGEMENT

export async function updateStaffRoleAction(
  rawInput: AdminStaffRoleInput
): Promise<AdminActionResult> {
  try {
    const session = await assertAdminSession();

    const parsed = adminStaffRoleSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid staff role data.",
      };
    }

    const { user_id, role, is_active } = parsed.data;
    const supabase = await createClient();

    // Check self-management and last active admin safeguard
    if (session.user && user_id === session.user.id && (role !== "ADMIN" || !is_active)) {
      const { count } = await supabase
        .from("staff_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "ADMIN")
        .eq("is_active", true);

      if ((count ?? 0) <= 1) {
        return {
          success: false,
          error:
            "Safety lock: Cannot remove or demote the only active admin. Assign another active admin first.",
        };
      }
    }

    const { error } = await supabase
      .from("staff_roles")
      .update({
        role,
        is_active,
      })
      .eq("user_id", user_id);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    revalidatePath("/staff");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update staff role.",
    };
  }
}

export async function createStaffMemberAction(
  rawInput: CreateStaffMemberInput
): Promise<AdminActionResult<{ user_id: string }>> {
  try {
    const session = await assertAdminSession();

    const parsed = createStaffMemberSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid staff member data.",
      };
    }

    const { name, email, password, phone, role } = parsed.data;
    const adminClient = createAdminClient();

    // 1. Create authenticated user in Supabase Auth with email_confirm: true
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: name,
          phone: phone || null,
          staff_role: role || null,
        },
      });

    if (authError || !authData.user) {
      console.error("[createStaffMemberAction] Auth createUser error:", authError);
      return {
        success: false,
        error: authError?.message || "Unable to add staff member. Please try again.",
      };
    }

    const newUserId = authData.user.id;

    // 2. Insert staff_roles entry using the authenticated Admin client
    const supabase = await createClient();
    const { error: roleError } = await supabase.from("staff_roles").insert({
      user_id: newUserId,
      role: "EMPLOYEE",
      is_active: true,
      created_by: session.user?.id || null,
    });

    if (phone) {
      try {
        await supabase.from("profiles").update({ phone }).eq("id", newUserId);
      } catch (profileErr) {
        console.warn("[createStaffMemberAction] Could not sync phone to profile:", profileErr);
      }
    }

    if (roleError) {
      console.error("[createStaffMemberAction] staff_roles insert error:", roleError);
      // Clean up the created auth user so an orphaned account is not left behind
      try {
        await adminClient.auth.admin.deleteUser(newUserId);
      } catch (cleanupErr) {
        console.error("[createStaffMemberAction] Cleanup auth user error:", cleanupErr);
      }

      return {
        success: false,
        error: "Unable to add staff member. Please try again.",
      };
    }

    revalidatePath("/admin");
    revalidatePath("/staff");
    return { success: true, data: { user_id: newUserId } };
  } catch (err) {
    console.error("[createStaffMemberAction] Unexpected error:", err);
    return {
      success: false,
      error: "Unable to add staff member. Please try again.",
    };
  }
}

export async function updateStaffMemberAction(
  rawInput: UpdateStaffMemberInput
): Promise<AdminActionResult> {
  try {
    await assertAdminSession();

    const parsed = updateStaffMemberSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid staff member data.",
      };
    }

    const { user_id, name, email, phone, role, password } = parsed.data;
    const adminClient = createAdminClient();

    // 1. Update auth attributes and user metadata
    const updateAttrs: {
      email?: string;
      password?: string;
      user_metadata: Record<string, unknown>;
    } = {
      email,
      user_metadata: {
        full_name: name,
        phone: phone || null,
        staff_role: role || null,
      },
    };

    if (password && password.trim().length >= 6) {
      updateAttrs.password = password.trim();
    }

    const { error: authError } = await adminClient.auth.admin.updateUserById(
      user_id,
      updateAttrs
    );

    if (authError) {
      console.error("[updateStaffMemberAction] Auth updateUserById error:", authError);
      return {
        success: false,
        error: "Unable to update staff member. Please try again.",
      };
    }

    // 2. Also update profiles table so database mirrors auth metadata
    try {
      const supabase = await createClient();
      await supabase
        .from("profiles")
        .update({
          full_name: name,
          phone: phone || null,
        })
        .eq("id", user_id);
    } catch (profileErr) {
      console.warn("[updateStaffMemberAction] Could not sync to profile:", profileErr);
    }

    revalidatePath("/admin");
    revalidatePath("/staff");
    return { success: true };
  } catch (err) {
    console.error("[updateStaffMemberAction] Unexpected error:", err);
    return {
      success: false,
      error: "Unable to update staff member. Please try again.",
    };
  }
}

export async function removeStaffMemberAction(
  rawInput: RemoveStaffMemberInput
): Promise<AdminActionResult> {
  try {
    const session = await assertAdminSession();

    const parsed = removeStaffMemberSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid staff member ID.",
      };
    }

    const { user_id } = parsed.data;

    // Self-removal safeguard
    if (session.user?.id === user_id) {
      return {
        success: false,
        error: "You cannot remove your own administrator account.",
      };
    }

    const supabase = await createClient();

    // Safeguard: check if target is an admin and the last active admin
    const { data: targetRole, error: fetchError } = await supabase
      .from("staff_roles")
      .select("role, is_active")
      .eq("user_id", user_id)
      .maybeSingle();

    if (fetchError || !targetRole) {
      console.error("[removeStaffMemberAction] Fetch target role error:", fetchError);
      return {
        success: false,
        error: "Staff member not found or already removed.",
      };
    }

    if (targetRole.role === "ADMIN") {
      const { count } = await supabase
        .from("staff_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "ADMIN")
        .eq("is_active", true);

      if ((count ?? 0) <= 1) {
        return {
          success: false,
          error: "Safety lock: You cannot remove the only active administrator account.",
        };
      }
    }

    // Soft deactivation preserves all historical orders and transactions
    const { error: updateError } = await supabase
      .from("staff_roles")
      .update({ is_active: false })
      .eq("user_id", user_id);

    if (updateError) {
      console.error("[removeStaffMemberAction] Deactivation error:", updateError);
      return {
        success: false,
        error: "Unable to remove staff member. Please try again.",
      };
    }

    revalidatePath("/admin");
    revalidatePath("/staff");
    return { success: true };
  } catch (err) {
    console.error("[removeStaffMemberAction] Unexpected error:", err);
    return {
      success: false,
      error: "Unable to remove staff member. Please try again.",
    };
  }
}

export const deleteStaffMemberAction = removeStaffMemberAction;
