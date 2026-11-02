/**
 * Security and Validation Test Suite for Namma Bakery Ordering Flow (Step 3.7)
 *
 * Verifies:
 * 1. Zod input schemas reject invalid customer data (name, phone, email, notes).
 * 2. Zod schemas reject invalid product/variant identifiers (non-UUIDs).
 * 3. Zod schemas reject invalid quantities (<=0, >20, fractions).
 * 4. Zod schemas strictly reject arbitrary injected fields (forged prices, forged totals, extra attributes).
 * 5. Zod schemas reject invalid/past/far-future pickup times.
 * 6. Rate limiter correctly enforces sliding window limits and rejects abusive bursts.
 */

import fs from "node:fs";
import path from "node:path";
import { placeOrderInputSchema, lookupOrderTokenSchema } from "../lib/orders/validation";
import {
  customCakeFormSchema,
  customCakePickupDateSchema,
  getEarliestCustomCakePickupDate,
  customCakeTrackingInputSchema,
  validateReferenceImageFile,
  validateImageMagicBytes,
} from "../lib/custom-cake/validation";
import {
  createTrackingSessionToken,
  verifyTrackingSessionToken,
  maskPhoneNumber,
} from "../lib/custom-cake/tracking-session";
import { checkRateLimit } from "../lib/security/rate-limiter";
import { DEFAULT_LOCATION_SLUG } from "../lib/pickup/queries";
import {
  adminCategorySchema,
  adminProductSchema,
  adminVariantSchema,
  adminPriceTierRuleSchema,
  adminStoreSettingsSchema,
  adminStaffRoleSchema,
} from "../lib/admin/validation";
import { publicStoreStatusSchema } from "../lib/pickup/validation";
import { dayRange, weekRange, monthRange, customRange } from "../lib/admin/order-history-types";
import { calculateOperationalSummary, getOrderPickupDateIst } from "../lib/staff/summary";
import type { StaffOrder } from "../lib/staff/types";
import {
  getCustomCakeCustomerStage,
  getCustomCakePickup,
  isCustomCakeStageClosed,
} from "../lib/custom-cake/customer-status";
import { getCustomCakeStaffStatus } from "../lib/staff/custom-cake-workflow";
import type { CustomCakeLinkedOrder, CustomCakeRequest } from "../lib/custom-cake/types";
import type { OrderStatus } from "../lib/orders/types";
import { formatIstDate, getIstDateString } from "../lib/utils/date";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failedCount++;
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
  }
}

console.log("\n========================================================");
console.log("NAMMA BAKERY: ORDERING FLOW SECURITY TESTS");
console.log("========================================================\n");

// --- 1. Customer Name Validation ---
console.log("--- 1. Customer Name Boundaries ---");

const validBaseOrder = {
  customerDetails: {
    customerName: "Vinay Kumar",
    customerPhone: "9845012345",
    customerEmail: "vinay@example.com",
    customerNotes: "Happy Birthday text on cake",
  },
  pickupSlotStart: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  items: [
    {
      productId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      kind: "TIERED_CAKE" as const,
      quantity: 1,
      cakeConfig: {
        weightGrams: 1000,
        eggType: "EGGLESS" as const,
        finish: "STANDARD" as const,
      },
    },
  ],
};

const parseResult = placeOrderInputSchema.safeParse(validBaseOrder);
assert(
  parseResult.success,
  "Valid baseline order payload accepted",
  !parseResult.success ? JSON.stringify(parseResult.error.format()) : undefined
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    customerDetails: { ...validBaseOrder.customerDetails, customerName: "A" },
  }).success,
  "Reject customer name < 2 characters"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    customerDetails: { ...validBaseOrder.customerDetails, customerName: "A".repeat(85) },
  }).success,
  "Reject customer name > 80 characters"
);

// --- 2. Customer Phone Validation ---
console.log("\n--- 2. Phone Number Validation & Normalization ---");

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    customerDetails: { ...validBaseOrder.customerDetails, customerPhone: "12345" },
  }).success,
  "Reject short phone number"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    customerDetails: { ...validBaseOrder.customerDetails, customerPhone: "1234567890" },
  }).success,
  "Reject phone number starting with invalid prefix (e.g. 1)"
);

assert(
  placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    customerDetails: { ...validBaseOrder.customerDetails, customerPhone: "+91 98450-12345" },
  }).success,
  "Accept and normalize valid Indian mobile with +91 and hyphens"
);

// --- 3. Forged Client Prices and Arbitrary Injected Fields ---
console.log("\n--- 3. Forged Client Prices & Strict Payload Rejection ---");

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    forgedTotalPaise: 100, // Injected malicious client price
  }).success,
  "Reject order payload with injected forged total field (.strict())"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    items: [
      {
        ...validBaseOrder.items[0],
        unitPricePaise: 100, // Injected forged unit price
      },
    ],
  }).success,
  "Reject item with injected client price field (.strict())"
);

// --- 4. Quantities and Item Limits ---
console.log("\n--- 4. Quantities & Item Limits ---");

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    items: [],
  }).success,
  "Reject empty items array (0 items)"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    items: [{ ...validBaseOrder.items[0], quantity: 0 }],
  }).success,
  "Reject quantity of 0"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    items: [{ ...validBaseOrder.items[0], quantity: -5 }],
  }).success,
  "Reject negative quantity"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    items: [{ ...validBaseOrder.items[0], quantity: 1.5 }],
  }).success,
  "Reject fractional/decimal quantity"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    items: [{ ...validBaseOrder.items[0], quantity: 25 }],
  }).success,
  "Reject quantity exceeding maximum line limit (> 20)"
);

// --- 5. Identifier Validation ---
console.log("\n--- 5. Product & Variant UUID Validation ---");

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    items: [{ ...validBaseOrder.items[0], productId: "invalid-product-id" }],
  }).success,
  "Reject non-UUID productId"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    items: [
      {
        productId: "11111111-1111-1111-1111-111111111111",
        kind: "SIMPLE" as const,
        variantId: "not-a-uuid",
        quantity: 1,
      },
    ],
  }).success,
  "Reject non-UUID variantId on simple product"
);

// --- 6. Pickup Time Window ---
console.log("\n--- 6. Pickup Time Boundaries ---");

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    pickupSlotStart: "not-a-date",
  }).success,
  "Reject unparseable date string"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    pickupSlotStart: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  }).success,
  "Reject pickup date in the past (> 2 hours ago)"
);

assert(
  !placeOrderInputSchema.safeParse({
    ...validBaseOrder,
    pickupSlotStart: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000).toISOString(),
  }).success,
  "Reject pickup date too far in the future (> 60 days)"
);

// --- 7. Order Token Lookup Validation ---
console.log("\n--- 7. Order Lookup Security Boundaries ---");

assert(
  lookupOrderTokenSchema.safeParse({ orderNumber: "NB1001", phone: "9845012345" }).success,
  "Accept valid order reference NB1001 with 10-digit phone"
);

assert(
  !lookupOrderTokenSchema.safeParse({ orderNumber: "1001", phone: "9845012345" }).success,
  "Reject order number missing NB prefix"
);

assert(
  !lookupOrderTokenSchema.safeParse({ orderNumber: "NB1001", phone: "12345" }).success,
  "Reject lookup with invalid/short phone"
);

assert(
  !lookupOrderTokenSchema.safeParse({
    orderNumber: "NB1001",
    phone: "9845012345",
    extra: "injected",
  }).success,
  "Reject lookup payload with extra fields (.strict())"
);

// --- 8. Rate Limiter ---
console.log("\n--- 8. In-Memory Sliding Window Rate Limiter ---");

const testKey = `test:rl:${Date.now()}`;
const maxAllowed = 3;
const windowMs = 5000;

const r1 = checkRateLimit({ key: testKey, maxRequests: maxAllowed, windowMs });
const r2 = checkRateLimit({ key: testKey, maxRequests: maxAllowed, windowMs });
const r3 = checkRateLimit({ key: testKey, maxRequests: maxAllowed, windowMs });
const r4 = checkRateLimit({ key: testKey, maxRequests: maxAllowed, windowMs });

assert(r1.allowed && r2.allowed && r3.allowed, "Allow requests within rate limit (1, 2, 3)");
assert(!r4.allowed, "Block request exceeding maxRequests (4th attempt rejected)");
assert(r4.retryAfterSeconds > 0, "Provide positive retryAfterSeconds when blocked");

// --- 9. Custom Cake Validation & Security ---
console.log("\n--- 9. Custom Cake Boundaries & File Constraints ---");

const validCustomCake = {
  customerName: "Priya Sharma",
  customerPhone: "9845012345",
  customerEmail: "priya@example.com",
  cakeType: "Birthday Celebration",
  flavour: "Dutch Chocolate Truffle",
  eggType: "EGGLESS" as const,
  weightGrams: 1500,
  shape: "Round",
  // A week from today, so the baseline stays valid whenever the suite runs.
  preferredPickupDate: getEarliestCustomCakePickupDate(Date.now() + 6 * 24 * 60 * 60 * 1000),
  preferredPickupTime: "2:00 PM – 4:00 PM",
  description: "Peppa pig themed 2-tier cake with pastel clouds and rainbow piping",
  messageOnCake: "Happy 3rd Birthday Anaya!",
  additionalNotes: "Less sugar in frosting please",
};

assert(
  customCakeFormSchema.safeParse(validCustomCake).success,
  "Valid custom cake baseline accepted"
);

// The egg type values must match the DB enum egg_type ('EGG','EGGLESS').
const eggTypeEnum = fs
  .readFileSync(path.join(process.cwd(), "supabase/migrations/0001_schema.sql"), "utf8")
  .match(/create type egg_type\s+as enum \(([^)]*)\)/)?.[1]
  .split(",")
  .map((v) => v.trim().replace(/'/g, ""));
assert(
  !!eggTypeEnum &&
    eggTypeEnum.every((v) => customCakeFormSchema.safeParse({ ...validCustomCake, eggType: v }).success),
  "Custom cake accepts every DB egg_type value (EGG, EGGLESS)"
);
assert(
  !customCakeFormSchema.safeParse({ ...validCustomCake, eggType: "REGULAR" }).success,
  "Custom cake rejects egg types the DB enum does not have"
);

assert(
  !customCakeFormSchema.safeParse({ ...validCustomCake, customerName: "P" }).success,
  "Reject custom cake customer name < 2 characters"
);

assert(
  !customCakeFormSchema.safeParse({ ...validCustomCake, customerPhone: "12345" }).success,
  "Reject custom cake invalid phone number"
);

assert(
  !customCakeFormSchema.safeParse({ ...validCustomCake, description: "cake" }).success,
  "Reject custom cake description < 10 characters"
);

assert(
  !customCakeFormSchema.safeParse({ ...validCustomCake, weightGrams: 100 }).success,
  "Reject custom cake weight below 250 grams"
);

assert(
  !customCakeFormSchema.safeParse({ ...validCustomCake, weightGrams: 25000 }).success,
  "Reject custom cake weight above 20,000 grams"
);

assert(
  !customCakeFormSchema.safeParse({
    ...validCustomCake,
    messageOnCake: "A".repeat(61),
  }).success,
  "Reject custom cake message > 60 characters"
);

assert(
  !customCakeFormSchema.safeParse({
    ...validCustomCake,
    injectedPrice: 500,
  }).success,
  "Reject custom cake payload with injected pricing fields (.strict())"
);

// File validation checks
assert(
  validateReferenceImageFile(null).valid,
  "Allow null reference image file (optional upload)"
);

const fakeValidFile = {
  size: 2 * 1024 * 1024,
  type: "image/jpeg",
} as File;
assert(
  validateReferenceImageFile(fakeValidFile).valid,
  "Allow valid JPEG file under 5MB"
);

const fakeOversizedFile = {
  size: 6 * 1024 * 1024,
  type: "image/png",
} as File;
assert(
  !validateReferenceImageFile(fakeOversizedFile).valid,
  "Reject oversized reference photo (> 5MB)"
);

const fakeInvalidMimeFile = {
  size: 1024 * 1024,
  type: "application/pdf",
} as File;
assert(
  !validateReferenceImageFile(fakeInvalidMimeFile).valid,
  "Reject disallowed MIME type (e.g. PDF/executable)"
);

// --- 10. Admin Area Validation & Security Boundaries (Step 6) ---
console.log("\n--- 10. Admin Area Validation & Authorization Boundaries ---");

// Categories
const validCategory = {
  name: "Signature Cakes",
  name_kn: "ಸಿಗ್ನೇಚರ್ ಕೇಕ್ಗಳು",
  slug: "signature-cakes",
  description: "Handcrafted celebration bakes",
  sort_order: 10,
  is_visible: true,
};
assert(
  adminCategorySchema.safeParse(validCategory).success,
  "Admin: Accept valid category payload"
);
assert(
  !adminCategorySchema.safeParse({ ...validCategory, name: "A" }).success,
  "Admin: Reject category name < 2 characters"
);
assert(
  !adminCategorySchema.safeParse({ ...validCategory, slug: "Invalid Slug with spaces" }).success,
  "Admin: Reject malformed category slug with spaces/caps"
);

// Products
const validSimpleProduct = {
  category_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  name: "Dilpasand",
  slug: "dilpasand",
  description: "Traditional coconut and tutti frutti pastry",
  kind: "SIMPLE" as const,
  price_tier_id: null,
  is_available: true,
  orderable_online: true,
  requires_confirmation: false,
  is_featured: true,
  is_best_seller: false,
  is_new_arrival: false,
  is_seasonal: false,
  lead_time_minutes: 60,
  sort_order: 1,
};
assert(
  adminProductSchema.safeParse(validSimpleProduct).success,
  "Admin: Accept valid Simple product without price tier"
);
assert(
  !adminProductSchema.safeParse({
    ...validSimpleProduct,
    price_tier_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  }).success,
  "Admin: Enforce database constraint: SIMPLE product cannot have price_tier_id"
);

const validTieredProduct = {
  category_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  name: "Black Forest Cake",
  slug: "black-forest-cake",
  kind: "TIERED_CAKE" as const,
  price_tier_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
  is_available: true,
  orderable_online: true,
  requires_confirmation: true,
  is_featured: false,
  is_best_seller: true,
  is_new_arrival: false,
  is_seasonal: false,
  lead_time_minutes: 240,
  sort_order: 2,
};
assert(
  adminProductSchema.safeParse(validTieredProduct).success,
  "Admin: Accept valid Tiered Cake with price tier"
);
assert(
  !adminProductSchema.safeParse({
    ...validTieredProduct,
    price_tier_id: null,
  }).success,
  "Admin: Enforce database constraint: TIERED_CAKE must have a price_tier_id"
);

// Variants
const validVariant = {
  product_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  label: "Pack of 4",
  price_paise: 16000,
  is_available: true,
  sort_order: 10,
};
assert(
  adminVariantSchema.safeParse(validVariant).success,
  "Admin: Accept valid variant with integer paise"
);
assert(
  !adminVariantSchema.safeParse({ ...validVariant, price_paise: -100 }).success,
  "Admin: Reject variant with negative price"
);
assert(
  !adminVariantSchema.safeParse({ ...validVariant, price_paise: 0 }).success,
  "Admin: Reject variant with zero price"
);
assert(
  !adminVariantSchema.safeParse({ ...validVariant, price_paise: 150.5 }).success,
  "Admin: Enforce integer paise (reject floating point prices)"
);

// Cake Price Tier Rules
const validTierRule = {
  tier_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
  weight_grams: 1000,
  egg_type: "EGGLESS" as const,
  finish: "STANDARD" as const,
  price_paise: 75000,
  is_active: true,
};
assert(
  adminPriceTierRuleSchema.safeParse(validTierRule).success,
  "Admin: Accept valid cake tier pricing rule"
);
assert(
  !adminPriceTierRuleSchema.safeParse({ ...validTierRule, weight_grams: 0 }).success,
  "Admin: Reject cake tier rule with weight <= 0"
);

// Store Settings
const validStoreSettings = {
  location_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  slot_minutes: 30 as const,
  max_orders_per_slot: 6,
  max_custom_per_day: 4,
  quote_validity_hours: 24,
  cancel_cutoff_hours: 4,
  pending_alert_minutes: 15,
};
assert(
  adminStoreSettingsSchema.safeParse(validStoreSettings).success,
  "Admin: Accept valid store slot & capacity settings"
);
assert(
  !adminStoreSettingsSchema.safeParse({ ...validStoreSettings, slot_minutes: 45 as unknown as 15 }).success,
  "Admin: Enforce valid slot_minutes enum (must be 15, 30, or 60)"
);
assert(
  !adminStoreSettingsSchema.safeParse({ ...validStoreSettings, max_orders_per_slot: -1 }).success,
  "Admin: Reject negative orders per slot"
);

// Staff Roles
const validStaffUpdate = {
  user_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  role: "ADMIN" as const,
  is_active: true,
};
assert(
  adminStaffRoleSchema.safeParse(validStaffUpdate).success,
  "Admin: Accept valid staff role update"
);
assert(
  !adminStaffRoleSchema.safeParse({ ...validStaffUpdate, role: "SUPER_ADMIN" as unknown as "EMPLOYEE" }).success,
  "Admin: Reject unsupported staff role value"
);
assert(
  !adminStaffRoleSchema.safeParse({ ...validStaffUpdate, user_id: "not-a-uuid" }).success,
  "Admin: Reject non-UUID staff user ID"
);

// --- 7. File Upload & Magic Bytes Verification ---
console.log("\n--- 7. File Upload Magic Bytes Security ---");

const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const fakeWebp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const maliciousHtml = Buffer.from("<script>alert('xss')</script>");

assert(validateImageMagicBytes(fakeJpeg), "File Upload: Accept valid JPEG binary signature");
assert(validateImageMagicBytes(fakePng), "File Upload: Accept valid PNG binary signature");
assert(validateImageMagicBytes(fakeWebp), "File Upload: Accept valid WebP binary signature");
assert(!validateImageMagicBytes(maliciousHtml), "File Upload: Reject HTML/script disguised as image");
assert(!validateImageMagicBytes(Buffer.from([0x00, 0x01])), "File Upload: Reject truncated buffer (<12 bytes)");

// --- 8. Staff Authentication Rate Limiting ---
console.log("\n--- 8. Staff Authentication Brute Force Rate Limiting ---");
const staffKey = `staff_login:ip:192.168.1.100`;
const staffMax = 5;
const staffWindow = 5 * 60 * 1000;

for (let i = 0; i < staffMax; i++) {
  checkRateLimit({ key: staffKey, maxRequests: staffMax, windowMs: staffWindow });
}
const staffBlocked = checkRateLimit({ key: staffKey, maxRequests: staffMax, windowMs: staffWindow });
assert(!staffBlocked.allowed, "Staff Login: Reject 6th login attempt within 5 minutes (brute-force defense)");

// --- 9. Public Store Status Exposure Boundaries ---
console.log("\n--- 9. Public Store Status Exposure Boundaries ---");

const validPublicStatus = {
  location_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  orders_paused_until: "2026-10-25T16:00:00.000Z",
  pause_message: "Taking orders shortly!",
  slot_minutes: 30,
};

assert(
  publicStoreStatusSchema.safeParse(validPublicStatus).success,
  "Store Status: Accept valid public store status payload"
);

assert(
  publicStoreStatusSchema.safeParse({
    orders_paused_until: null,
    pause_message: null,
    slot_minutes: 30,
  }).success,
  "Store Status: Accept unpaused store status with null pause info"
);

assert(
  !publicStoreStatusSchema.safeParse({
    ...validPublicStatus,
    max_orders_per_slot: 6, // Leaked internal capacity
  }).success,
  "Store Status: Reject payload exposing internal capacity (max_orders_per_slot)"
);

assert(
  !publicStoreStatusSchema.safeParse({
    ...validPublicStatus,
    max_custom_per_day: 4, // Leaked internal capacity
  }).success,
  "Store Status: Reject payload exposing internal capacity (max_custom_per_day)"
);

assert(
  !publicStoreStatusSchema.safeParse({
    ...validPublicStatus,
    quote_validity_hours: 24, // Leaked business rule
  }).success,
  "Store Status: Reject payload exposing quote_validity_hours"
);

assert(
  !publicStoreStatusSchema.safeParse({
    ...validPublicStatus,
    max_open_orders_per_phone: 3, // Leaked anti-abuse threshold
  }).success,
  "Store Status: Reject payload exposing max_open_orders_per_phone"
);

assert(
  !publicStoreStatusSchema.safeParse({
    ...validPublicStatus,
    cancel_cutoff_hours: 4, // Leaked operational threshold
  }).success,
  "Store Status: Reject payload exposing cancel_cutoff_hours"
);

assert(
  !publicStoreStatusSchema.safeParse({
    ...validPublicStatus,
    pending_alert_minutes: 15, // Leaked operational threshold
  }).success,
  "Store Status: Reject payload exposing pending_alert_minutes"
);

// --- 10. Service Role Location Permission & Migration Integrity ---
console.log("\n--- 10. Service Role Location Permission & Migration Integrity ---");

const workspaceRoot = path.resolve(__dirname, "..");
const migration0006Path = path.join(workspaceRoot, "supabase", "migrations", "0006_grant_service_role_locations_read.sql");
const test005Path = path.join(workspaceRoot, "supabase", "tests", "005_locations_permission.test.sql");
const seedSqlPath = path.join(workspaceRoot, "supabase", "seed.sql");
const orderActionPath = path.join(workspaceRoot, "lib", "orders", "actions.ts");
const cakeActionPath = path.join(workspaceRoot, "lib", "custom-cake", "actions.ts");

assert(fs.existsSync(migration0006Path), "Migration 0006 exists in supabase/migrations/");

const migration0006Content = fs.existsSync(migration0006Path)
  ? fs.readFileSync(migration0006Path, "utf-8")
  : "";

assert(
  /grant\s+select\s+on\s+(table\s+)?public\.locations\s+to\s+service_role/i.test(migration0006Content),
  "Migration 0006 grants SELECT on public.locations to service_role"
);

assert(
  !/grant\s+(insert|update|delete|all)\s+on/i.test(migration0006Content),
  "Migration 0006 enforces least-privilege (no INSERT/UPDATE/DELETE/ALL granted)"
);

assert(fs.existsSync(test005Path), "Database test 005_locations_permission.test.sql exists");

const test005Content = fs.existsSync(test005Path)
  ? fs.readFileSync(test005Path, "utf-8")
  : "";

assert(
  test005Content.includes("has_table_privilege('service_role', 'public.locations', 'SELECT')"),
  "Database test 005 asserts service_role SELECT privilege on public.locations"
);

const seedSqlContent = fs.existsSync(seedSqlPath)
  ? fs.readFileSync(seedSqlPath, "utf-8")
  : "";

assert(
  seedSqlContent.includes(`'${DEFAULT_LOCATION_SLUG}'`),
  `DEFAULT_LOCATION_SLUG ('${DEFAULT_LOCATION_SLUG}') matches seed data location slug`
);

const orderActionContent = fs.readFileSync(orderActionPath, "utf-8");
const cakeActionContent = fs.readFileSync(cakeActionPath, "utf-8");

assert(
  !orderActionContent.includes(".limit(1)"),
  "placeOrderAction does not use arbitrary fallback location (.limit(1) removed)"
);

assert(
  !cakeActionContent.includes(".limit(1)"),
  "submitCustomCakeRequestAction does not use arbitrary fallback location (.limit(1) removed)"
);

assert(
  orderActionContent.includes('.eq("slug", DEFAULT_LOCATION_SLUG)') &&
    orderActionContent.includes('.eq("is_active", true)'),
  "placeOrderAction requires both DEFAULT_LOCATION_SLUG and is_active=true"
);

assert(
  cakeActionContent.includes('.eq("slug", DEFAULT_LOCATION_SLUG)') &&
    cakeActionContent.includes('.eq("is_active", true)'),
  "submitCustomCakeRequestAction requires both DEFAULT_LOCATION_SLUG and is_active=true"
);

// --- 11. Custom Cake Tracking Dashboard Security Boundaries ---

// --- Admin order history deletion ---
console.log("\n--- Admin Order History: ranges + authorization wiring ---");
const day = dayRange("2026-11-01");
assert(
  day?.from === "2026-10-31T18:30:00.000Z" && day?.to === "2026-11-01T18:30:00.000Z",
  "Order History: day range is the IST day expressed in UTC"
);
const week = weekRange("2026-11-01"); // a Sunday
assert(
  week?.label === "26 Oct 2026 – 1 Nov 2026" && week?.from === "2026-10-25T18:30:00.000Z",
  "Order History: week is Monday-Sunday (Sunday belongs to the week that ends on it)"
);
const month = monthRange("2026-10");
assert(
  month?.from === "2026-09-30T18:30:00.000Z" && month?.to === "2026-10-31T18:30:00.000Z" && month?.label === "October 2026",
  "Order History: month range covers the whole IST month"
);
assert(dayRange("2026-02-30") === null, "Order History: impossible date rejected");
assert(customRange("2026-11-02", "2026-11-01") === null, "Order History: reversed custom range rejected");
assert(customRange("2026-10-01", "2026-10-02")?.to === "2026-10-02T18:30:00.000Z", "Order History: custom range end is inclusive");

const historyActions = fs.readFileSync(path.join(process.cwd(), "lib/admin/order-history-actions.ts"), "utf8");
const exportedActions = historyActions.match(/export async function \w+/g) ?? [];
assert(exportedActions.length === 3, "Order History: exactly 3 admin server actions exported (preview, delete, photo cleanup)");
assert(
  (historyActions.match(/await assertAdminSession\(\)/g) ?? []).length === exportedActions.length,
  "Order History: every server action calls assertAdminSession()"
);
assert(!/createAdminClient|SUPABASE_SECRET_KEY/.test(historyActions), "Order History: actions never use the service-role client");
assert(/confirmText !== "DELETE"/.test(historyActions), "Order History: typed confirmation is enforced server side");

const staffHistory = fs.readFileSync(path.join(process.cwd(), "lib/staff/order-history-actions.ts"), "utf8");
assert(
  !/\.rpc\("(admin_|purge_)|\.delete\(|\.update\(|\.insert\(|createAdminClient|SUPABASE_SECRET_KEY/.test(staffHistory),
  "Staff History: read-only actions (no delete/update/insert, no admin RPC, no service role)"
);
assert(
  (staffHistory.match(/await assertStaff\(\)/g) ?? []).length === 2,
  "Staff History: both read actions require an active staff session"
);
const staffDashboardSrc = fs.readFileSync(path.join(process.cwd(), "components/staff/staff-dashboard.tsx"), "utf8");
assert(/<OrderHistoryView canDelete=\{false\} \/>/.test(staffDashboardSrc), "Staff History: staff portal renders the history read-only (canDelete=false)");
const adminDashboardSrc = fs.readFileSync(path.join(process.cwd(), "components/admin/admin-dashboard.tsx"), "utf8");
assert(/<OrderHistoryView canDelete \/>/.test(adminDashboardSrc), "Admin History: admin portal renders deletion controls");
const migration13 = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0013_staff_order_history_list.sql"), "utf8");
assert(/if not is_staff\(\) then raise exception 'forbidden'/.test(migration13) && !/to anon/.test(migration13), "Staff History: list function requires is_staff() and is not granted to anon");
const historyView = fs.readFileSync(path.join(process.cwd(), "components/history/order-history-view.tsx"), "utf8");
assert(/canDelete && /.test(historyView) && (historyView.match(/setDetail\(/g) ?? []).length === 2 && (historyView.match(/onClick=\{\(\) => setDetail\(/g) ?? []).length === 1, "History UI: delete controls gated on canDelete; details opened only by the record click handler");

const storageHelper = fs.readFileSync(path.join(process.cwd(), "lib/admin/order-history-storage.ts"), "utf8");
assert(
  /^import "server-only";/.test(storageHelper) && /\.storage\.from\(BUCKET\)\.remove\(/.test(storageHelper) && !/\.from\("(orders|custom_cake_requests|payments)"\)/.test(storageHelper),
  "Order History: storage cleanup helper is server-only and only touches the cleanup queue + cake-reference files"
);
const migration15 = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0015_custom_cake_retention_cleanup.sql"), "utf8");
assert(
  /grant execute on function public\.purge_old_order_history\(int\) to service_role/.test(migration15) &&
    /revoke all on public\.storage_cleanup_queue from public, anon, authenticated/.test(migration15) &&
    /enable row level security/.test(migration15) && !/cron\.schedule/.test(migration15),
  "Retention: cleanup is service_role only, the photo queue is private, and no second cron job is created"
);
assert(
  /custom_cake_requests r[\s\S]*r\.status in \('DECLINED','CUSTOMER_DECLINED','EXPIRED','WITHDRAWN'\)/.test(migration15) &&
    !/'PENDING'|'ACCEPTED'|'READY_FOR_PICKUP'/.test(migration15.split("-- automatic retention")[1] ?? ""),
  "Retention: only terminal custom cake history is selected (never active statuses)"
);
const migration14 = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0014_custom_cake_history_deletion.sql"), "utf8");
assert(
  (migration14.match(/if not is_admin\(\) then raise exception 'forbidden'/g) ?? []).length === 2 && /if not is_staff\(\) then raise exception 'forbidden'/.test(migration14),
  "Custom Cake History: admin delete/preview re-check is_admin(); history list requires is_staff()"
);
assert(
  !/to anon/.test(migration14) && !/_delete_history_orders\(uuid\[\], text, jsonb\) to /.test(migration14),
  "Custom Cake History: nothing granted to anon; internal delete helper has no grants"
);
const staffDir = path.join(process.cwd(), "components/staff");
const staffSources = fs.readdirSync(staffDir).map((f) => fs.readFileSync(path.join(staffDir, f), "utf8")).join("\n");
assert(
  !/order-history-actions|deleteOrderHistoryAction|admin_delete_order_history/.test(staffSources),
  "Order History: staff portal components never reference the delete actions"
);
const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0012_admin_order_history_deletion.sql"), "utf8");
assert(
  (migration.match(/if not is_admin\(\) then raise exception 'forbidden'/g) ?? []).length === 3,
  "Order History: all 3 admin_* database functions re-check is_admin()"
);
assert(
  /grant execute on function public\.purge_old_order_history\(int\) to service_role/.test(migration) &&
    !/purge_old_order_history\(int\) to authenticated/.test(migration),
  "Order History: retention cleanup is service_role only"
);

console.log("\n--- 11. Custom Cake Tracking Dashboard Security Boundaries ---");

assert(
  customCakeTrackingInputSchema.safeParse({
    enquiryNumber: "CC1022",
    phone: "9845012345",
  }).success,
  "Custom Cake Track: Accept valid enquiry reference CC1022 with 10-digit phone"
);

assert(
  customCakeTrackingInputSchema.safeParse({
    enquiryNumber: "cc1022",
    phone: "+91 98450 12345",
  }).success,
  "Custom Cake Track: Normalize lowercase enquiry number and formatted Indian mobile"
);

assert(
  !customCakeTrackingInputSchema.safeParse({
    enquiryNumber: "NB1001",
    phone: "9845012345",
  }).success,
  "Custom Cake Track: Reject standard order number (NBxxxx) in custom cake tracker"
);

assert(
  !customCakeTrackingInputSchema.safeParse({
    enquiryNumber: "1022",
    phone: "9845012345",
  }).success,
  "Custom Cake Track: Reject enquiry number missing CC prefix"
);

assert(
  !customCakeTrackingInputSchema.safeParse({
    enquiryNumber: "CC1022",
    phone: "12345",
  }).success,
  "Custom Cake Track: Reject invalid/short phone number"
);

assert(
  !customCakeTrackingInputSchema.safeParse({
    enquiryNumber: "CC1022",
    phone: "9845012345",
    injected: "attacker-field",
  }).success,
  "Custom Cake Track: Strictly reject arbitrary injected payload fields (.strict())"
);

// HMAC Token creation & verification
const testPhone = "9876543210";
const testEnquiry = "CC1022";
const validToken = createTrackingSessionToken({
  phone: testPhone,
  verifiedRequestNumber: testEnquiry,
});

const verified = verifyTrackingSessionToken(validToken);
assert(
  verified !== null && verified.phone === testPhone && verified.verifiedRequestNumber === testEnquiry,
  "Tracking Session: Successfully verify valid HMAC-signed tracking session token"
);

// Tampered token
const tamperedToken = validToken.slice(0, -4) + "XXXX";
assert(
  verifyTrackingSessionToken(tamperedToken) === null,
  "Tracking Session: Reject tampered signature in session token"
);

// Forged payload
const forgedParts = validToken.split(".");
const fakePayload = Buffer.from(
  JSON.stringify({ phone: "9999999999", verifiedRequestNumber: "CC9999", expiresAt: Date.now() + 10000 })
).toString("base64url");
const forgedToken = `${fakePayload}.${forgedParts[1]}`;
assert(
  verifyTrackingSessionToken(forgedToken) === null,
  "Tracking Session: Reject token with forged payload"
);

// Phone masking
assert(
  maskPhoneNumber("9876543215") === "+91 ••••• •3215",
  "Tracking Session: Mask phone number safely for customer view"
);

// --- Custom cake internal staff notes stay staff-only (#56) ---
console.log("\n--- 12. Custom Cake Internal Notes Privacy ---");
const migration16 = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/0016_internal_custom_cake_notes.sql"),
  "utf8"
);
assert(
  /insert into request_messages \(request_id, sender, staff_id, body, is_internal\)\s*values \(p_request_id, 'STAFF', auth\.uid\(\), p_body, true\)/i.test(migration16),
  "Internal Notes: post_request_message_staff stores notes as internal"
);
assert(
  /request_messages m where m\.request_id = r\.id and not m\.is_internal/.test(migration16),
  "Internal Notes: get_request_by_token excludes internal messages"
);
assert(
  /create policy request_messages_read[\s\S]*not is_internal/.test(migration16),
  "Internal Notes: RLS hides internal messages from signed-in customers"
);
for (const file of ["lib/custom-cake/tracking-actions.ts", "lib/custom-cake/actions.ts"]) {
  const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const reads = (src.match(/request_messages \(/g) || []).length;
  const filters = (src.match(/\.eq\("request_messages\.is_internal", false\)/g) || []).length;
  assert(
    reads > 0 && reads === filters,
    `Internal Notes: every customer-facing request_messages read in ${file} filters is_internal`
  );
}

// --- Hidden or archived categories hide and block their products (#58) ---
console.log("\n--- 13. Hidden Categories ---");
const migration17 = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/0017_hide_products_in_hidden_categories.sql"),
  "utf8"
);
assert(
  /create policy products_read[\s\S]*c\.is_visible[\s\S]*c\.archived_at is null/.test(migration17),
  "Hidden Categories: products_read hides products of hidden or archived categories from customers"
);
assert(
  /before insert on public\.order_items[\s\S]*ensure_order_item_category_visible/.test(migration17) &&
    /raise exception 'PRODUCT_UNAVAILABLE: %'/.test(migration17),
  "Hidden Categories: orders reject items from hidden or archived categories with PRODUCT_UNAVAILABLE"
);



// --- Order notes are not copied onto cakes as inscriptions (#59) ---
console.log("\n--- 14. Checkout Notes vs Cake Inscriptions ---");
const checkoutFormSrc = fs.readFileSync(path.join(process.cwd(), "components/checkout/checkout-form.tsx"), "utf8");
assert(
  !/cakeMessage\s*:[^,}]*customerNotes/.test(checkoutFormSrc),
  "Checkout: special instructions are not copied into each cake's inscription"
);

// --- Employees can cancel orders: cancelled_by matches its check constraint (#60) ---
console.log("\n--- 15. Staff Cancellation Role ---");
const schemaSql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0001_schema.sql"), "utf8");
const migration18 = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0018_staff_cancelled_by.sql"), "utf8");
const allowedCancelledBy = (schemaSql.match(/cancelled_by\s+text check \(cancelled_by in \(([^)]*)\)\)/)?.[1] ?? "")
  .split(",")
  .map((v) => v.trim().replace(/'/g, ""));
const writtenCancelledBy = [...(migration18.match(/cancelled_by\s+= case when p_to = 'CANCELLED' then \(([^)]*)\)/)?.[1] ?? "").matchAll(/'([A-Z]+)'/g)].map((m) => m[1]);
assert(
  writtenCancelledBy.length > 0 && writtenCancelledBy.every((v) => allowedCancelledBy.includes(v)),
  `Staff Cancel: transition_order only writes allowed cancelled_by values (${writtenCancelledBy.join(", ")})`
);
assert(
  !/cancelled_by\s+= case when p_to = 'CANCELLED' then v_role/.test(migration18),
  "Staff Cancel: cancelled_by no longer stores the raw app_role (EMPLOYEE)"
);

// --- Staff queue is organised by pickup day, pending is global (#61) ---
console.log("\n--- 16. Staff Queue Pickup Date ---");
const mkOrder = (o: Partial<StaffOrder>) => ({ id: Math.random().toString(36), status: "ACCEPTED", ...o }) as StaffOrder;
const queueOrders = [
  // placed on Monday, picked up on Wednesday
  mkOrder({ created_at: "2026-11-02T10:00:00+05:30", requested_pickup_at: "2026-11-04T16:00:00+05:30" }),
  // placed 11:50 PM Tuesday, picked up Wednesday
  mkOrder({ created_at: "2026-11-03T23:50:00+05:30", requested_pickup_at: "2026-11-04T11:00:00+05:30" }),
  // pending order for Friday
  mkOrder({ status: "PENDING", created_at: "2026-11-03T09:00:00+05:30", requested_pickup_at: "2026-11-06T12:00:00+05:30" }),
  // requested Wednesday, bakery confirmed Thursday
  mkOrder({ created_at: "2026-11-03T09:00:00+05:30", requested_pickup_at: "2026-11-04T10:00:00+05:30", confirmed_pickup_at: "2026-11-05T10:00:00+05:30" }),
];
const wednesday = calculateOperationalSummary(queueOrders, "2026-11-04");
assert(wednesday.totalToday === 2, `Staff Queue: Wednesday shows the 2 orders due for pickup that day (got ${wednesday.totalToday})`);
assert(wednesday.pending === 1, `Staff Queue: Pending counts pending orders for every pickup date (got ${wednesday.pending})`);
assert(
  getOrderPickupDateIst(queueOrders[3]) === "2026-11-05",
  "Staff Queue: the confirmed pickup time takes precedence over the requested one"
);
assert(
  getOrderPickupDateIst(queueOrders[1]) === "2026-11-04",
  "Staff Queue: an order placed late at night is grouped under its pickup day"
);

// --- Accepting a custom cake is all-or-nothing (#63) ---
console.log("\n--- 17. Custom Cake Accept Is Atomic ---");
const migration19 = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/0019_atomic_custom_cake_accept.sql"),
  "utf8"
);
const acceptFn = migration19.match(
  /create or replace function public\.staff_accept_custom_request\([\s\S]*?end \$\$;/
)?.[0] ?? "";
assert(acceptFn.length > 0, "Atomic Accept: migration 0019 defines staff_accept_custom_request");
assert(
  /if not is_staff\(\)/.test(acceptFn),
  "Atomic Accept: staff_accept_custom_request checks the caller is staff"
);
assert(
  ["staff_review_request(", "staff_send_quote(", "customer_accept_quote("].every((step) =>
    acceptFn.includes(step)
  ),
  "Atomic Accept: review, quote and order creation run inside the one function (one transaction)"
);
assert(
  /revoke all on function public\.staff_accept_custom_request\([^)]*\) from public, anon;/.test(migration19) &&
    /grant execute on function public\.staff_accept_custom_request\([^)]*\) to authenticated, service_role;/.test(migration19),
  "Atomic Accept: callable by signed-in staff and the server only, not anonymous users"
);
assert(
  /update public\.custom_cake_requests r\s+set status = 'UNDER_REVIEW'\s+where r\.status = 'QUOTED'\s+and not exists \(select 1 from public\.orders o where o\.custom_request_id = r\.id\)/.test(migration19),
  "Atomic Accept: requests already stuck as QUOTED with no order are put back in review"
);
const staffCakeActions = fs.readFileSync(path.join(process.cwd(), "lib/custom-cake/staff-actions.ts"), "utf8");
const acceptAction = staffCakeActions.slice(
  staffCakeActions.indexOf("export async function acceptCustomCakeAsOrderAction"),
  staffCakeActions.indexOf("export async function addCustomCakeStaffNoteAction")
);
const acceptRpcs = [...acceptAction.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
assert(
  acceptRpcs.length === 1 && acceptRpcs[0] === "staff_accept_custom_request",
  `Atomic Accept: the Staff Portal accept makes a single database call (got ${acceptRpcs.join(", ") || "none"})`
);

// --- Customer pages follow the linked order (#62) ---
console.log("\n--- 18. Custom Cake Customer Status Follows The Order ---");
const linkedOrder = (status: OrderStatus, pickup_at = "2026-11-05T16:00:00+05:30"): CustomCakeLinkedOrder => ({
  order_number: "NB1001",
  public_token: "t".repeat(32),
  status,
  pickup_at,
});
const expectedCustomerStage: Record<OrderStatus, string> = {
  PENDING: "CONFIRMED",
  ACCEPTED: "CONFIRMED",
  PREPARING: "CONFIRMED",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  COMPLETED: "COLLECTED",
  REJECTED: "CANCELLED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
};
for (const [orderStatus, expected] of Object.entries(expectedCustomerStage) as [OrderStatus, string][]) {
  const stage = getCustomCakeCustomerStage("CUSTOMER_ACCEPTED", linkedOrder(orderStatus));
  assert(
    stage === expected,
    `Customer Status: an accepted request whose order is ${orderStatus} shows ${expected} (got ${stage})`
  );
  // Staff and customers must agree on whether the cake is still going ahead.
  const staffStatus = getCustomCakeStaffStatus(
    { status: "CUSTOMER_ACCEPTED" } as CustomCakeRequest,
    { status: orderStatus } as StaffOrder
  );
  const staffClosed = ["CANCELLED", "REJECTED", "NO_SHOW"].includes(staffStatus);
  assert(
    staffClosed === isCustomCakeStageClosed(stage),
    `Customer Status: staff (${staffStatus}) and customer (${stage}) agree for a ${orderStatus} order`
  );
}
assert(
  getCustomCakeCustomerStage("QUOTED", null) === "IN_REVIEW",
  "Customer Status: a QUOTED request with no order is not shown as confirmed"
);
assert(
  getCustomCakeCustomerStage("CUSTOMER_ACCEPTED", null) === "CONFIRMED",
  "Customer Status: older requests confirmed before orders existed still show as confirmed"
);
const movedPickup = getCustomCakePickup({
  status: "CUSTOMER_ACCEPTED",
  preferred_pickup_at: "2026-11-05T10:00:00+05:30",
  order: linkedOrder("ACCEPTED", "2026-11-05T16:00:00+05:30"),
});
assert(
  movedPickup.confirmed && movedPickup.changed && movedPickup.at === "2026-11-05T16:00:00+05:30",
  "Customer Status: the bakery's confirmed pickup time is shown, and flagged when it differs from the request"
);
const samePickup = getCustomCakePickup({
  status: "CUSTOMER_ACCEPTED",
  preferred_pickup_at: "2026-11-05T10:00:00.000Z",
  order: linkedOrder("ACCEPTED", "2026-11-05T15:30:00+05:30"),
});
assert(
  samePickup.confirmed && !samePickup.changed,
  "Customer Status: the same instant in a different format is not flagged as changed"
);
const unconfirmedPickup = getCustomCakePickup({
  status: "UNDER_REVIEW",
  preferred_pickup_at: "2026-11-05T10:00:00+05:30",
});
assert(
  !unconfirmedPickup.confirmed && unconfirmedPickup.at === "2026-11-05T10:00:00+05:30",
  "Customer Status: before acceptance the requested pickup time is shown"
);
for (const file of ["lib/custom-cake/tracking-actions.ts", "lib/custom-cake/actions.ts"]) {
  const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  assert(
    src.includes("getLinkedOrdersByRequestId(") && /order: linkedOrders\.get\(/.test(src),
    `Customer Status: ${file} loads the linked order for the customer view`
  );
}
const linkedOrdersSrc = fs.readFileSync(path.join(process.cwd(), "lib/custom-cake/linked-orders.ts"), "utf8");
const selectedOrderCols = (linkedOrdersSrc.match(/\.select\(\s*"([^"]+)"/)?.[1] ?? "")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);
const grantedOrderCols = (
  fs
    .readFileSync(path.join(process.cwd(), "supabase/migrations/0020_custom_cake_order_status_read.sql"), "utf8")
    .match(/grant select \(([^)]+)\)\s+on table public\.orders to service_role;/)?.[1] ?? ""
)
  .split(",")
  .map((c) => c.trim());
assert(
  selectedOrderCols.length > 0 && selectedOrderCols.every((c) => grantedOrderCols.includes(c)),
  `Customer Status: the server reads only order columns granted by migration 0020 (${selectedOrderCols.join(", ")})`
);
assert(
  !grantedOrderCols.some((c) => /phone|email|name|notes|reason|paise/.test(c)),
  "Customer Status: the service-role grant on orders excludes customer details, notes and amounts"
);
const broadcastSrc = fs.readFileSync(path.join(process.cwd(), "lib/realtime/broadcast.ts"), "utf8");
assert(
  /customRequestTopic\(data\.custom_request_id\)/.test(broadcastSrc),
  "Customer Status: a change to a custom cake order also refreshes the customer's custom cake tracker"
);

// --- Custom cake pickup date must be tomorrow or later in IST (#64) ---
console.log("\n--- 19. Custom Cake Pickup Date Needs A Day's Notice ---");
const DAY_MS = 24 * 60 * 60 * 1000;
const todayIst = getIstDateString();
const tomorrowIst = getEarliestCustomCakePickupDate();
assert(
  getEarliestCustomCakePickupDate(new Date("2026-11-03T18:00:00Z")) === "2026-11-04",
  "Pickup Date: at 11:30 PM IST the earliest pickup date is the next day"
);
assert(
  getEarliestCustomCakePickupDate(new Date("2026-11-03T20:00:00Z")) === "2026-11-05",
  "Pickup Date: at 1:30 AM IST (still the previous day in UTC) the earliest date follows IST"
);
assert(
  !customCakeFormSchema.safeParse({ ...validCustomCake, preferredPickupDate: todayIst }).success,
  "Pickup Date: the server rejects a same-day pickup date"
);
assert(
  !customCakeFormSchema.safeParse({
    ...validCustomCake,
    preferredPickupDate: getIstDateString(Date.now() - DAY_MS),
  }).success,
  "Pickup Date: the server rejects a past pickup date"
);
assert(
  customCakeFormSchema.safeParse({ ...validCustomCake, preferredPickupDate: tomorrowIst }).success,
  "Pickup Date: tomorrow (IST) is accepted"
);
const tooSoon = customCakePickupDateSchema.safeParse(todayIst);
assert(
  !tooSoon.success &&
    /at least a day's notice/.test(tooSoon.error.issues[0]?.message ?? "") &&
    (tooSoon.error.issues[0]?.message ?? "").includes(
      formatIstDate(`${tomorrowIst}T12:00:00+05:30`)
    ),
  "Pickup Date: the too-soon message names the earliest date the customer can pick"
);
assert(
  !customCakePickupDateSchema.safeParse("2027-02-30").success &&
    !customCakePickupDateSchema.safeParse("2027-13-01").success,
  "Pickup Date: dates that don't exist (30 Feb, month 13) are rejected"
);
const emptyDate = customCakePickupDateSchema.safeParse("");
const missingDate = customCakePickupDateSchema.safeParse(null);
assert(
  !emptyDate.success &&
    !missingDate.success &&
    emptyDate.error.issues[0]?.message === "Please choose a pickup date." &&
    missingDate.error.issues[0]?.message === "Please choose a pickup date.",
  "Pickup Date: an empty or missing date asks the customer to choose one"
);
const customCakeFormSrc = fs.readFileSync(
  path.join(process.cwd(), "components/custom-cake/custom-cake-form.tsx"),
  "utf8"
);
assert(
  /customCakePickupDateSchema\.safeParse\(preferredPickupDate\)/.test(customCakeFormSrc) &&
    /min=\{tomorrowIst\}/.test(customCakeFormSrc) &&
    /getEarliestCustomCakePickupDate\(\)/.test(customCakeFormSrc),
  "Pickup Date: the form checks the date with the same rule before it submits"
);

console.log("\n========================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("========================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
