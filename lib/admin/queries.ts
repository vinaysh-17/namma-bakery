import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_LOCATION_SLUG } from "@/lib/pickup/queries";
import type {
  AdminOverviewSummary,
  AdminCategory,
  AdminProduct,
  AdminPriceTierWithRules,
  AdminPriceTierRule,
  LocationInfo,
  StoreSettings,
  SpecialClosure,
  BusinessHour,
  AdminStaffMember,
  AuditLogEntry,
} from "./types";

/**
 * Fetches high-level operational metrics for the Admin Dashboard overview.
 */
export async function getAdminOverviewSummary(): Promise<{
  summary: AdminOverviewSummary;
  error?: string | null;
}> {
  const defaultSummary: AdminOverviewSummary = {
    totalProducts: 0,
    availableProducts: 0,
    archivedProducts: 0,
    totalCategories: 0,
    visibleCategories: 0,
    pendingOrders: 0,
    pendingCustomCakes: 0,
    totalStaff: 0,
    activeStaff: 0,
    adminCount: 0,
    isStorePaused: false,
    pauseMessage: null,
    ordersPausedUntil: null,
    slotMinutes: 30,
    maxOrdersPerSlot: 6,
  };

  try {
    const supabase = await createClient();

    const [
      productsRes,
      categoriesRes,
      ordersRes,
      customCakesRes,
      staffRes,
      locationRes,
    ] = await Promise.all([
      supabase.from("products").select("id, is_available, archived_at"),
      supabase.from("categories").select("id, is_visible, archived_at"),
      supabase
        .from("orders")
        .select("id, status")
        .in("status", ["PENDING", "ACCEPTED", "PREPARING"]),
      supabase
        .from("custom_cake_requests")
        .select("id, status")
        .in("status", ["SUBMITTED", "UNDER_REVIEW", "NEEDS_CLARIFICATION"]),
      supabase.from("staff_roles").select("role, is_active"),
      supabase
        .from("locations")
        .select("id, store_settings(*)")
        .eq("slug", DEFAULT_LOCATION_SLUG)
        .maybeSingle(),
    ]);

    const products = productsRes.data ?? [];
    const categories = categoriesRes.data ?? [];
    const staff = staffRes.data ?? [];

    const totalProducts = products.length;
    const availableProducts = products.filter(
      (p) => p.is_available && !p.archived_at
    ).length;
    const archivedProducts = products.filter((p) => p.archived_at).length;

    const totalCategories = categories.length;
    const visibleCategories = categories.filter(
      (c) => c.is_visible && !c.archived_at
    ).length;

    const pendingOrders = ordersRes.data?.length ?? 0;
    const pendingCustomCakes = customCakesRes.data?.length ?? 0;

    const totalStaff = staff.length;
    const activeStaff = staff.filter((s) => s.is_active).length;
    const adminCount = staff.filter(
      (s) => s.role === "ADMIN" && s.is_active
    ).length;

    const rawSettings = locationRes.data?.store_settings as
      | StoreSettings[]
      | StoreSettings
      | null;
    const settings = Array.isArray(rawSettings)
      ? rawSettings[0]
      : rawSettings;

    // Live store pause evaluation is performed by client components from ordersPausedUntil
    // to prevent Next.js prerender unstable Date.now() warnings while preserving exact future vs expired semantics.
    const isStorePaused = false;

    return {
      summary: {
        totalProducts,
        availableProducts,
        archivedProducts,
        totalCategories,
        visibleCategories,
        pendingOrders,
        pendingCustomCakes,
        totalStaff,
        activeStaff,
        adminCount,
        isStorePaused,
        pauseMessage: settings?.pause_message ?? null,
        ordersPausedUntil: settings?.orders_paused_until ?? null,
        slotMinutes: settings?.slot_minutes ?? 30,
        maxOrdersPerSlot: settings?.max_orders_per_slot ?? 6,
      },
    };
  } catch (err) {
    console.error("[getAdminOverviewSummary] Failed:", err);
    return {
      summary: defaultSummary,
      error: "Failed to load dashboard overview data.",
    };
  }
}

/**
 * Fetches all menu categories with associated product counts.
 */
export async function getAdminCategories(): Promise<{
  categories: AdminCategory[];
  error?: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data: categories, error } = await supabase
      .from("categories")
      .select("*, products(id)")
      .order("sort_order", { ascending: true });

    if (error) {
      return { categories: [], error: error.message };
    }

    const formatted = (categories ?? []).map((cat) => ({
      ...cat,
      product_count: Array.isArray(cat.products) ? cat.products.length : 0,
    }));

    return { categories: formatted as AdminCategory[] };
  } catch (err) {
    console.error("[getAdminCategories] Failed:", err);
    return { categories: [], error: "Failed to load categories." };
  }
}

/**
 * Fetches all products with full category, variants, and price tier associations.
 */
export async function getAdminProducts(): Promise<{
  products: AdminProduct[];
  error?: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("products")
      .select(
        `
        *,
        category:categories(id, name, slug),
        product_variants(*),
        price_tiers(id, name),
        product_images(*)
      `
      )
      .order("sort_order", { ascending: true });

    if (error) {
      return { products: [], error: error.message };
    }

    return { products: (data as AdminProduct[]) ?? [] };
  } catch (err) {
    console.error("[getAdminProducts] Failed:", err);
    return { products: [], error: "Failed to load products." };
  }
}

type PriceRuleNoteRow = { note: string | null; verified: boolean };
type PriceRuleRow = Omit<AdminPriceTierRule, "note" | "verified"> & {
  price_tier_rule_notes?: PriceRuleNoteRow | PriceRuleNoteRow[] | null;
};
type PriceTierRow = Omit<AdminPriceTierWithRules, "price_tier_rules"> & {
  price_tier_rules: PriceRuleRow[] | null;
};

/**
 * Fetches all cake price tiers and their pricing rules, including the internal note / verified
 * flag. Those live in the admin-only table price_tier_rule_notes (GitHub issue #72): it is read
 * with the admin's own session, so RLS (is_admin()) returns nothing to anyone else.
 */
export async function getAdminPriceTiers(): Promise<{
  tiers: AdminPriceTierWithRules[];
  error?: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("price_tiers")
      .select("*, price_tier_rules(*, price_tier_rule_notes(note, verified))")
      .order("sort_order", { ascending: true });

    if (error) {
      return { tiers: [], error: error.message };
    }

    // Flatten the one-to-one notes row back onto each rule (rules without a notes row have no
    // note and are not verified).
    const tiers: AdminPriceTierWithRules[] = ((data as PriceTierRow[] | null) ?? []).map(
      (tier) => ({
        ...tier,
        price_tier_rules: (tier.price_tier_rules ?? []).map(
          ({ price_tier_rule_notes, ...rule }) => {
            const notes = Array.isArray(price_tier_rule_notes)
              ? price_tier_rule_notes[0]
              : price_tier_rule_notes;
            return { ...rule, note: notes?.note ?? null, verified: notes?.verified ?? false };
          }
        ),
      })
    );

    return { tiers };
  } catch (err) {
    console.error("[getAdminPriceTiers] Failed:", err);
    return { tiers: [], error: "Failed to load price tiers." };
  }
}

/**
 * Fetches store settings, location data, business hours, and special closures.
 */
export async function getAdminStoreSettings(): Promise<{
  location: LocationInfo | null;
  settings: StoreSettings | null;
  closures: SpecialClosure[];
  hours: BusinessHour[];
  error?: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data: location, error: locError } = await supabase
      .from("locations")
      .select("*")
      .eq("slug", DEFAULT_LOCATION_SLUG)
      .maybeSingle();

    if (locError || !location) {
      return {
        location: null,
        settings: null,
        closures: [],
        hours: [],
        error: "Location not found.",
      };
    }

    const [settingsRes, closuresRes, hoursRes] = await Promise.all([
      supabase
        .from("store_settings")
        .select("*")
        .eq("location_id", location.id)
        .maybeSingle(),
      supabase
        .from("special_closures")
        .select("*")
        .eq("location_id", location.id)
        .order("closure_date", { ascending: true }),
      supabase
        .from("business_hours")
        .select("*")
        .eq("location_id", location.id)
        .order("weekday", { ascending: true }),
    ]);

    return {
      location: location as LocationInfo,
      settings: settingsRes.data as StoreSettings | null,
      closures: (closuresRes.data as SpecialClosure[]) ?? [],
      hours: (hoursRes.data as BusinessHour[]) ?? [],
    };
  } catch (err) {
    console.error("[getAdminStoreSettings] Failed:", err);
    return {
      location: null,
      settings: null,
      closures: [],
      hours: [],
      error: "Failed to load store settings.",
    };
  }
}

/**
 * Fetches all active staff members with their profile and authentication information.
 */
export async function getAdminStaffMembers(): Promise<{
  staff: AdminStaffMember[];
  error?: string | null;
}> {
  try {
    const supabase = await createClient();

    // Inactive (removed) staff are included deliberately (GitHub #69): the admin UI
    // needs to see them to offer reactivation. staff_roles_admin RLS already grants
    // admins full access regardless of is_active.
    const { data, error } = await supabase
      .from("staff_roles")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[getAdminStaffMembers] Query staff_roles error:", error);
      return { staff: [], error: error.message };
    }

    // Retrieve profiles for phone and full_name without unsupported cross-table join
    const userIds = (data ?? []).map((row) => row.user_id);
    let profileMap = new Map<
      string,
      { full_name?: string | null; phone?: string | null }
    >();

    if (userIds.length > 0) {
      const { data: profilesData, error: profileErr } = await supabase
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", userIds);

      if (!profileErr && profilesData) {
        profileMap = new Map(
          profilesData.map((p) => [
            p.id,
            { full_name: p.full_name, phone: p.phone },
          ])
        );
      }
    }

    // Retrieve emails and user metadata for exactly these staff user IDs, by ID
    // (GitHub #89). listUsers({page:1, perPage:200}) only ever returned the first 200
    // auth users account-wide -- every customer "Find My Orders" OTP login also
    // creates one, so any staff member past that page showed "No email" regardless of
    // how many staff actually exist. Fetching by ID is correct at any auth-user count
    // and only touches the (typically small) set of staff accounts.
    const authMap = new Map<
      string,
      { email?: string; metadata?: Record<string, unknown> }
    >();
    try {
      const adminClient = createAdminClient();
      const results = await Promise.all(
        userIds.map((id) => adminClient.auth.admin.getUserById(id))
      );
      for (const { data, error } of results) {
        if (!error && data?.user) {
          authMap.set(data.user.id, {
            email: data.user.email,
            metadata: data.user.user_metadata,
          });
        }
      }
    } catch (e) {
      console.warn("[getAdminStaffMembers] Could not fetch auth user details:", e);
    }

    const formatted: AdminStaffMember[] = (data ?? []).map((row) => {
      const prof = profileMap.get(row.user_id);
      const authInfo = authMap.get(row.user_id);
      const orgRole = authInfo?.metadata?.staff_role as
        | "Manager"
        | "Staff"
        | "Chef"
        | null
        | undefined;

      return {
        user_id: row.user_id,
        email: authInfo?.email ?? null,
        role: row.role,
        organizational_role: orgRole || null,
        is_active: row.is_active,
        created_at: row.created_at,
        created_by: row.created_by,
        full_name:
          prof?.full_name || (authInfo?.metadata?.full_name as string) || null,
        phone: prof?.phone || (authInfo?.metadata?.phone as string) || null,
      };
    });

    return { staff: formatted };
  } catch (err) {
    console.error("[getAdminStaffMembers] Failed:", err);
    return { staff: [], error: "Failed to load staff list." };
  }
}

/**
 * Fetches recent administrative audit logs.
 */
export async function getAdminAuditLogs(limit = 20): Promise<{
  logs: AuditLogEntry[];
  error?: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { logs: [], error: error.message };
    }

    return { logs: (data as AuditLogEntry[]) ?? [] };
  } catch (err) {
    console.error("[getAdminAuditLogs] Failed:", err);
    return { logs: [], error: "Failed to load audit logs." };
  }
}
