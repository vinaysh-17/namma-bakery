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
import { createIdempotencyKey, IDEMPOTENCY_KEY_PATTERN } from "../lib/orders/idempotency";
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
import type { PriceTierRule } from "../lib/menu/types";
import type { AdminPriceTierRule } from "../lib/admin/types";
import { formatIstDate, getIstDateString } from "../lib/utils/date";
import { mapCartRpcError, extractProductName } from "../lib/orders/cart-errors";
import { deriveCartIssues } from "../lib/cart/cart-issues";
import type { CartItem } from "../lib/cart/types";
import type { CartItemCheck } from "../lib/orders/types";
import { validateCartInputSchema } from "../lib/orders/validation";
import {
  evaluateSelectedSlot,
  getLeadSignature,
  getRequiredLeadMinutes,
  describeInvalidSlot,
  type SlotRow,
} from "../lib/pickup/slot-validity";
import {
  getOrderableVariants,
  hasAnyVariants,
  getSimpleProductPurchaseState,
  resolveSimpleProductSelection,
  describeUnavailableOnAdd,
  describeInvalidSelection,
} from "../lib/menu/variant-availability";

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

// --- Order placement idempotency (issue #98) ---
console.log("\n--- Order Idempotency: keys, schema, wiring ---");
const goodKey = createIdempotencyKey();
assert(IDEMPOTENCY_KEY_PATTERN.test(goodKey), "Idempotency: generated key matches the database format");
assert(goodKey !== createIdempotencyKey(), "Idempotency: every checkout attempt gets a different key");
assert(
  placeOrderInputSchema.safeParse({ ...validBaseOrder, idempotencyKey: goodKey }).success,
  "Idempotency: order input with a valid key is accepted"
);
assert(placeOrderInputSchema.safeParse(validBaseOrder).success, "Idempotency: order input without a key still accepted (backward compatible)");
assert(!placeOrderInputSchema.safeParse({ ...validBaseOrder, idempotencyKey: "short" }).success, "Idempotency: too-short key rejected");
assert(!placeOrderInputSchema.safeParse({ ...validBaseOrder, idempotencyKey: "has spaces and symbols!!" }).success, "Idempotency: key with illegal characters rejected");
assert(!placeOrderInputSchema.safeParse({ ...validBaseOrder, idempotencyKey: "x".repeat(101) }).success, "Idempotency: over-long key rejected");

const ordersAction = fs.readFileSync(path.join(process.cwd(), "lib/orders/actions.ts"), "utf8");
assert(/p_idempotency_key: parsed\.data\.idempotencyKey \?\? null/.test(ordersAction), "Idempotency: server action passes the key to place_order");
assert(/if \(!replayed\) \{\s*await notifyStaffChanged\(\)/.test(ordersAction), "Idempotency: a replay does not notify staff a second time");
const checkoutSrc = fs.readFileSync(path.join(process.cwd(), "components/checkout/checkout-form.tsx"), "utf8");
assert(/idempotencyKey: attemptRef\.current\.key/.test(checkoutSrc), "Idempotency: checkout form sends the attempt key");
assert(/catch \(err\) \{[\s\S]*?inFlightRef\.current = false/.test(checkoutSrc) && !/catch \(err\) \{[\s\S]{0,400}attemptRef\.current = null/.test(checkoutSrc), "Idempotency: a network error keeps the same key for the retry");
assert(/attemptRef\.current = null;\s*inFlightRef\.current = false;\s*setSubmitError\(actionResult\.error\)/.test(checkoutSrc), "Idempotency: a definite server refusal starts a new attempt");
const migration21 = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0021_order_idempotency.sql"), "utf8");
assert(/create unique index if not exists orders_idempotency_key_uidx[\s\S]*where idempotency_key is not null/.test(migration21), "Idempotency: database enforces one order per key (unique index)");
assert(/to service_role;/.test(migration21) && !/to (anon|authenticated|public)/.test(migration21.replace(/revoke[\s\S]*?;/g, "")), "Idempotency: place_order remains service_role only");

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

// --- Stale admin screens cannot override or cancel finished orders (#79) ---
console.log("\n--- 16. Stale-State Protection for Order Transitions ---");
const migration22 = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0022_transition_order_stale_state.sql"), "utf8");
const staffActionsSrc = fs.readFileSync(path.join(process.cwd(), "lib/staff/actions.ts"), "utf8");
const statusModalSrc = fs.readFileSync(path.join(process.cwd(), "components/staff/staff-status-modal.tsx"), "utf8");

const fnBody = migration22.slice(migration22.indexOf("create or replace function public.transition_order"));
assert(
  fnBody.indexOf("STALE_STATE") > -1 &&
    fnBody.indexOf("STALE_STATE") < fnBody.indexOf("from order_transitions where from_status"),
  "Stale State: the database compares the expected status BEFORE looking up any transition or override"
);
assert(
  /select \* into o from orders where id = p_order_id for update;[\s\S]*STALE_STATE/.test(fnBody),
  "Stale State: the order row is locked before the expected status is compared"
);
assert(
  /if p_expected_from is null then\s*raise exception 'EXPECTED_STATUS_REQUIRED'/.test(fnBody),
  "Stale State: an admin override can never run without an expected status"
);
assert(/o\.status = 'COMPLETED' then\s*raise exception 'ORDER_FINAL'/.test(fnBody), "Stale State: a completed order cannot be overridden");
assert(
  /o\.payment_status = 'paid' and p_to in \('CANCELLED','REJECTED'\)[\s\S]*PAID_ORDER_CANNOT_BE_CANCELLED/.test(fnBody),
  "Stale State: a paid order cannot be cancelled or rejected by an override"
);
assert(
  /grant execute on function public\.transition_order\(uuid, order_status, text, timestamptz, order_status\)\s*to authenticated, service_role/.test(migration22) &&
    !/to (anon|public)\b/.test(migration22.replace(/revoke[\s\S]*?;/g, "")),
  "Stale State: transition_order stays callable only by signed-in roles (it checks is_staff() itself)"
);
const rpcCalls = staffActionsSrc.match(/rpc\("transition_order", \{[\s\S]*?\}\)/g) ?? [];
assert(
  rpcCalls.length >= 4 && rpcCalls.every((c) => /p_expected_from/.test(c)),
  `Stale State: every transition_order call in the staff actions sends the expected status (${rpcCalls.length} calls)`
);
assert(/expectedFrom: OrderStatus;/.test(staffActionsSrc), "Stale State: transitionOrderAction requires the expected status");
assert(/expectedFrom: order\.status,/.test(statusModalSrc), "Stale State: the status modal sends the status its screen shows");
assert(
  /STALE_STATE"\)\) \{\s*return \{ success: false, stale: true/.test(staffActionsSrc),
  "Stale State: a database STALE_STATE is returned to the UI as a refresh-and-review message"
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

// --- Custom cake form errors appear where the customer is looking (#65) ---
console.log("\n--- 20. Custom Cake Form Errors Are Visible ---");
const submitAreaAt = customCakeFormSrc.indexOf("{/* Submit Button */}");
const section1At = customCakeFormSrc.indexOf("{/* SECTION 1");
const bannerAt = customCakeFormSrc.indexOf("{errorMessage && (");
assert(
  submitAreaAt > 0 &&
    bannerAt > submitAreaAt &&
    customCakeFormSrc.indexOf("{errorMessage && (", bannerAt + 1) === -1,
  "Form Errors: submit errors are shown next to the Submit button, not at the top of the form"
);
assert(
  section1At > 0 &&
    !customCakeFormSrc.slice(customCakeFormSrc.indexOf("<form"), section1At).includes("errorMessage"),
  "Form Errors: there is no error banner above the first section any more"
);
assert(
  /errorRef\.current\?\.scrollIntoView\(/.test(customCakeFormSrc) &&
    /errorRef\.current\?\.focus\(/.test(customCakeFormSrc) &&
    /\}, \[errorMessage\]\);/.test(customCakeFormSrc) &&
    /ref=\{errorRef\}\s+tabIndex=\{-1\}\s+role="alert"/.test(customCakeFormSrc),
  "Form Errors: a failed submit scrolls its message into view and focuses it"
);
const bannerMessages = [...customCakeFormSrc.matchAll(/setErrorMessage\(([^)\n]*)/g)]
  .map((m) => m[1].trim())
  .filter((arg) => arg !== "null");
assert(
  bannerMessages.length === 2 &&
    bannerMessages.some((arg) => arg.startsWith("res.error")) &&
    bannerMessages.some((arg) => /network error/.test(arg)),
  "Form Errors: only server and network failures use the submit message; field problems show at the field"
);
assert(
  ["setWeightError(nextWeightError)", "setDescriptionError(nextDescriptionError)", "setDateError(nextDateError)", "setNameError(nextNameError)", "setPhoneError(nextPhoneError)"].every(
    (call) => customCakeFormSrc.includes(call)
  ) &&
    ["customWeight-error", "description-error", "preferredPickupDate-error", "customerName-error", "customerPhone-error"].every(
      (id) => customCakeFormSrc.includes(`id="${id}"`)
    ),
  "Form Errors: every checked field (weight, description, date, name, phone) shows its own error"
);
const fieldOrder = ["customWeightRef.current]", "descriptionRef.current]", "dateRef.current]", "nameRef.current]", "phoneRef.current]"].map(
  (ref) => customCakeFormSrc.indexOf(ref)
);
assert(
  fieldOrder.every((at, i) => at > 0 && (i === 0 || at > fieldOrder[i - 1])) &&
    /field\?\.scrollIntoView\(/.test(customCakeFormSrc) &&
    /field\?\.focus\(/.test(customCakeFormSrc),
  "Form Errors: the form takes the customer to the first problem in page order"
);
assert(
  /setFileError\("Reference photo must be under 5MB in size\."\)/.test(customCakeFormSrc) &&
    /setFileError\("Only PNG, JPEG, and WebP image formats are accepted\."\)/.test(customCakeFormSrc),
  "Form Errors: photo problems are shown under the photo upload"
);

// --- Cart validated against the live menu (GitHub issue #75) ---
console.log("\n--- Cart Validated Against The Live Menu (#75) ---");

const SIMPLE_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const simpleOrderItem = { productId: SIMPLE_ID, kind: "SIMPLE" as const, variantId: VARIANT_ID, quantity: 1 };

// Input: the price the customer saw may be sent for COMPARISON; forged price/total fields stay rejected
const withExpected = placeOrderInputSchema.safeParse({
  ...validBaseOrder,
  items: [{ ...simpleOrderItem, expectedUnitPricePaise: 27000 }],
});
assert(withExpected.success, "Live menu: an item may carry the price the customer saw (for comparison)");
assert(
  !placeOrderInputSchema.safeParse({ ...validBaseOrder, items: [{ ...simpleOrderItem, expectedUnitPricePaise: -1 }] }).success,
  "Live menu: a negative expected price is rejected"
);
assert(
  !placeOrderInputSchema.safeParse({ ...validBaseOrder, items: [{ ...simpleOrderItem, expectedUnitPricePaise: 270.5 }] }).success,
  "Live menu: a fractional expected price is rejected"
);
assert(
  !placeOrderInputSchema.safeParse({ ...validBaseOrder, items: [{ ...simpleOrderItem, unitPricePaise: 1 }] }).success &&
    !placeOrderInputSchema.safeParse({ ...validBaseOrder, items: [{ ...simpleOrderItem, price: 1 }] }).success &&
    !placeOrderInputSchema.safeParse({ ...validBaseOrder, totalPaise: 1 }).success,
  "Live menu: forged price / total fields are still rejected"
);
assert(
  validateCartInputSchema.safeParse({ items: [simpleOrderItem] }).success &&
    !validateCartInputSchema.safeParse({ items: [] }).success &&
    !validateCartInputSchema.safeParse({ items: [simpleOrderItem], total: 1 }).success &&
    !validateCartInputSchema.safeParse({ items: Array.from({ length: 21 }, () => simpleOrderItem) }).success,
  "Live menu: the cart check input is strict (1-20 items, no extra fields)"
);

// Error mapping: specific, safe and clear that no order was created
const priceMsg = mapCartRpcError("PRICE_CHANGED: Black Forest");
assert(
  priceMsg?.code === "PRICE_CHANGED" && /"Black Forest"/.test(priceMsg.error) && /price/.test(priceMsg.error) && /not placed/.test(priceMsg.error),
  "Live menu: a price change is reported by item name and says the order was not placed"
);
const goneMsg = mapCartRpcError("PRODUCT_NOT_FOUND: Veg Puff");
assert(
  goneMsg?.code === "PRODUCT_NOT_FOUND" && /"Veg Puff" is no longer available/.test(goneMsg.error) && /not placed/.test(goneMsg.error),
  "Live menu: a removed product is named instead of a generic failure"
);
const noNameMsg = mapCartRpcError("PRODUCT_NOT_FOUND: ");
assert(
  noNameMsg?.code === "PRODUCT_NOT_FOUND" && /An item in your cart is no longer available/.test(noNameMsg.error),
  "Live menu: a removed product with no known name still gets a readable message"
);
const optionMsg = mapCartRpcError("OPTION_NOT_AVAILABLE: Vanilla");
assert(
  optionMsg?.code === "OPTION_NOT_AVAILABLE" && /"Vanilla"/.test(optionMsg.error),
  "Live menu: an unavailable variant / cake option is named"
);
assert(mapCartRpcError("PRODUCT_UNAVAILABLE: Mango Cake")?.code === "PRODUCT_UNAVAILABLE", "Live menu: an unavailable product is mapped");
assert(mapCartRpcError("SLOT_FULL") === null && mapCartRpcError("duplicate key value violates unique constraint") === null, "Live menu: unrelated errors are left to the other handlers");
const hostile = mapCartRpcError('PRICE_CHANGED: Cake"; drop table orders;--\nDETAIL: Key (id)=(x) already exists');
assert(
  hostile !== null &&
    !/DETAIL|Key \(id\)|already exists/.test(hostile.error) &&
    !/[;\r\n]/.test(hostile.error.replace(/"[^"]*"/, "")) &&
    hostile.error.length < 300,
  "Live menu: only the item name is taken from the database message (no second line or raw detail)"
);
assert(extractProductName("PRICE_CHANGED: " + "A".repeat(500), "PRICE_CHANGED").length <= 80, "Live menu: product names in messages are length-limited");
assert(extractProductName("PRICE_CHANGED: ಚಾಕೊಲೇಟ್ ಕೇಕ್ 1kg", "PRICE_CHANGED").includes("ಚಾಕೊಲೇಟ್"), "Live menu: Kannada product names are preserved");

// Comparing the cart with the live menu: the database price is the only price that counts
const cartLine = (over: Partial<CartItem>): CartItem => ({
  itemKey: "simple:a:v",
  productId: SIMPLE_ID,
  productSlug: "a",
  productName: "Veg Puff",
  categorySlug: "snacks",
  kind: "SIMPLE",
  variantId: VARIANT_ID,
  unitPricePaise: 5000,
  quantity: 2,
  ...over,
});
const liveCheck = (over: Partial<CartItemCheck>): CartItemCheck => ({
  index: 0,
  status: "OK",
  productName: "Veg Puff",
  currentUnitPricePaise: 5000,
  ...over,
});
assert(deriveCartIssues([cartLine({})], [liveCheck({})]).length === 0, "Live menu: a current cart has no issues");
const priceIssue = deriveCartIssues([cartLine({})], [liveCheck({ currentUnitPricePaise: 6000 })]);
assert(
  priceIssue.length === 1 && priceIssue[0].kind === "PRICE_CHANGED" &&
    priceIssue[0].kind === "PRICE_CHANGED" && priceIssue[0].oldUnitPricePaise === 5000 && priceIssue[0].newUnitPricePaise === 6000,
  "Live menu: a stale cart price is detected with the old and the live price"
);
assert(
  deriveCartIssues([cartLine({})], [liveCheck({ currentUnitPricePaise: 4000 })])[0]?.kind === "PRICE_CHANGED",
  "Live menu: a price DROP is also reported (never silently changed)"
);
const goneIssue = deriveCartIssues([cartLine({})], [liveCheck({ status: "PRODUCT_NOT_FOUND", currentUnitPricePaise: null })]);
assert(goneIssue[0]?.kind === "UNAVAILABLE" && goneIssue[0].reason === "PRODUCT", "Live menu: a removed product is flagged unavailable");
const variantIssue = deriveCartIssues([cartLine({})], [liveCheck({ status: "OPTION_NOT_AVAILABLE", currentUnitPricePaise: null })]);
assert(variantIssue[0]?.kind === "UNAVAILABLE" && variantIssue[0].reason === "OPTION", "Live menu: an unavailable variant is flagged separately from the product");
const mixed = deriveCartIssues(
  [cartLine({}), cartLine({ itemKey: "simple:b:v", productName: "Brownie", unitPricePaise: 9000 }), cartLine({ itemKey: "simple:c:v", unitPricePaise: 1000 })],
  [
    liveCheck({ index: 0 }),
    liveCheck({ index: 1, productName: "Brownie", currentUnitPricePaise: 9500 }),
    liveCheck({ index: 2, status: "PRODUCT_UNAVAILABLE", currentUnitPricePaise: null }),
  ]
);
assert(
  mixed.length === 2 && mixed[0].itemKey === "simple:b:v" && mixed[1].itemKey === "simple:c:v",
  "Live menu: only the changed lines are reported, in cart order"
);
assert(deriveCartIssues([cartLine({})], [liveCheck({ index: 7 })]).length === 0, "Live menu: a result for an unknown cart position is ignored");

// Wiring (static): the server action sends the expected price only for comparison
const actionsSrc = fs.readFileSync(path.join(process.cwd(), "lib/orders/actions.ts"), "utf8");
assert(
  (actionsSrc.match(/expected_unit_price_paise: it\.expectedUnitPricePaise/g) || []).length === 2,
  "Live menu: both simple and cake lines pass the expected price to place_order"
);
assert(!/(?<!expected_)unit_price_paise: it\./.test(actionsSrc) && !/total_paise/.test(actionsSrc), "Live menu: the server action never sends a price or total to be stored");
assert(/mapCartRpcError\(msg\)/.test(actionsSrc) && /export async function validateCartAction/.test(actionsSrc), "Live menu: place order maps cart errors and the cart check action exists");
assert(
  /createAdminClient\(\)[\s\S]*?rpc\("check_cart_items"/.test(actionsSrc) && /cartcheck:ip:/.test(actionsSrc),
  "Live menu: the cart check runs server-side, is read-only (check_cart_items) and is rate limited"
);
assert(
  /expectedUnitPricePaise: item\.unitPricePaise/.test(checkoutSrc) &&
    /disabled=\{!isPickupValid \|\| isSubmitting \|\| hasCartIssues\}/.test(checkoutSrc) &&
    /CartChangesNotice/.test(checkoutSrc),
  "Live menu: checkout sends the seen price, shows what changed and blocks Place Order until reviewed"
);
assert(
  /attemptRef\.current = null;\s*inFlightRef\.current = false;\s*setSubmitError\(actionResult\.error\)/.test(checkoutSrc) &&
    /CART_CHANGED_CODES\.has\(actionResult\.code\)/.test(checkoutSrc),
  "Live menu: a stale-cart refusal is a definite refusal (new idempotency key next time) and refreshes the notice"
);
const summarySrc = fs.readFileSync(path.join(process.cwd(), "components/checkout/checkout-order-summary.tsx"), "utf8");
assert(!/Exact order amount/.test(summarySrc), "Live menu: checkout no longer calls an unverified total the 'Exact order amount'");

// Migration 0023 (static checks of the SQL text; behaviour is covered by supabase/tests/009)
const migration23 = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0023_cart_live_menu_validation.sql"), "utf8");
const placeOrder23 = migration23.slice(migration23.indexOf("create or replace function public.place_order"), migration23.indexOf("-- read-only cart check"));
assert(/raise exception 'PRICE_CHANGED: %', prod\.name/.test(placeOrder23), "Live menu SQL: a changed price raises PRICE_CHANGED with the product name");
assert(
  /v_unit := rule\.price_paise/.test(placeOrder23) && /v_unit := var\.price_paise/.test(placeOrder23) &&
    !/v_unit := v_expected|v_total := v_total \+ v_expected/.test(placeOrder23),
  "Live menu SQL: the order is always priced from the live catalog, never from the expected price"
);
assert(
  placeOrder23.indexOf("idempotency_key = v_key") > 0 &&
    placeOrder23.indexOf("idempotency_key = v_key") < placeOrder23.indexOf("PRICE_CHANGED"),
  "Live menu SQL: an idempotent replay is answered before prices are compared (a retry never fails on a later price change)"
);
assert(
  placeOrder23.indexOf("insert into orders") < placeOrder23.indexOf("PRICE_CHANGED") && /raise exception/.test(placeOrder23),
  "Live menu SQL: the refusal happens inside the transaction after the order row, so it rolls back (no partial order, key not consumed)"
);
assert(!/drop function/.test(migration23) && /create or replace function public\.place_order/.test(migration23), "Live menu SQL: place_order keeps its signature (no new overload)");
assert(
  /revoke execute on function public\.place_order\(uuid, uuid, text, text, text, timestamptz, text, jsonb, text\)\s+from public, anon, authenticated;/.test(migration23) &&
    /grant execute on function public\.place_order\([^)]*\)\s+to service_role;/.test(migration23),
  "Live menu SQL: place_order stays service_role only"
);
const checkFn23 = migration23.slice(migration23.indexOf("create or replace function public.check_cart_items"));
assert(
  /language plpgsql stable security definer set search_path = public/.test(checkFn23) &&
    !/\b(insert|update|delete)\b\s+(into|from)?\s*(public\.)?\w+/i.test(checkFn23.replace(/--.*$/gm, "").replace(/select[\s\S]*?;/gi, "")) &&
    /grant execute on function public\.check_cart_items\(jsonb\) to service_role/.test(checkFn23) &&
    /revoke execute on function public\.check_cart_items\(jsonb\) from public, anon, authenticated/.test(checkFn23),
  "Live menu SQL: check_cart_items is read-only and service_role only"
);
assert(
  /c\.is_visible or c\.archived_at is not null/.test(checkFn23) && /archived_at is null/.test(checkFn23) && /is_available and archived_at is null/.test(checkFn23),
  "Live menu SQL: the cart check applies the same availability rules as place_order (including hidden categories)"
);

// --- Pickup slot revalidated after cart changes (GitHub issue #76) ---
console.log("\n--- Pickup Slot Revalidation After Cart Changes (#76) ---");

// A model of the database's available_slots(): 30-minute slots 10:00-21:30 IST on one day,
// each offered when it starts at or after now + lead time. (The real function is exercised by
// supabase/tests/010; this model lets us test the decision rules on their own.)
const NOW_MS = Date.parse("2026-11-10T04:30:00.000Z"); // 10:00 AM IST
const slotAt = (hourIst: number, minute: number) =>
  new Date(Date.parse(`2026-11-10T00:00:00+05:30`) + (hourIst * 60 + minute) * 60_000).toISOString();
const modelAvailableSlots = (leadMinutes: number, full: string[] = []): SlotRow[] => {
  const rows: SlotRow[] = [];
  for (let m = 10 * 60; m <= 21 * 60 + 30; m += 30) {
    const start = slotAt(Math.floor(m / 60), m % 60);
    if (Date.parse(start) >= NOW_MS + leadMinutes * 60_000) {
      rows.push({ slot_start: start, remaining: full.includes(start) ? 0 : 3 });
    }
  }
  return rows;
};
const judge = (slotStart: string, leadMinutes: number, full: string[] = []) =>
  evaluateSelectedSlot({
    slotStart,
    requiredLeadMinutes: leadMinutes,
    slotsForCart: modelAvailableSlots(leadMinutes, full),
    slotsAnyLead: modelAvailableSlots(0, full),
  });

const SLOT_1230 = slotAt(12, 30); // 2.5 hours after "now"
const SLOT_1500 = slotAt(15, 0);

// 1. harmless: a short-lead cart keeps a later slot valid
assert(judge(SLOT_1230, 60).valid === true, "Slot #76: a selected slot stays valid for a cart whose lead time it still satisfies");
// 2. adding a product that needs a longer lead time invalidates the slot, for the right reason
const afterAddingCake = judge(SLOT_1230, 240);
assert(
  !afterAddingCake.valid && !afterAddingCake.valid && afterAddingCake.reason === "LEAD_TIME_NOT_MET",
  "Slot #76: adding an item with a longer lead time invalidates the selected slot (lead time)"
);
assert(judge(SLOT_1500, 240).valid === true, "Slot #76: a later slot is still valid for that longer lead time");
// 3. lead time is the longest among the cart's products, not a sum and not per quantity
assert(getRequiredLeadMinutes([60, 240, 60]) === 240 && getRequiredLeadMinutes([]) === 0, "Slot #76: required lead time is the longest lead time in the cart");
// 4. removing the item makes the slot valid again
assert(judge(SLOT_1230, 60).valid === true && !judge(SLOT_1230, 240).valid, "Slot #76: removing the long-lead item makes the same slot valid again");
// 5. quantity / variant changes do not alter which products are in the cart, so they trigger no re-check
const cartA = [
  { productId: "p-cake", quantity: 1, variantId: "v-1" },
  { productId: "p-puff", quantity: 2, variantId: "v-9" },
];
const cartQty = [
  { productId: "p-cake", quantity: 5, variantId: "v-1" },
  { productId: "p-puff", quantity: 2, variantId: "v-9" },
];
const cartVariant = [
  { productId: "p-cake", quantity: 1, variantId: "v-2" },
  { productId: "p-puff", quantity: 2, variantId: "v-9" },
];
const cartReordered = [cartA[1], cartA[0]];
assert(
  getLeadSignature(cartA) === getLeadSignature(cartQty) &&
    getLeadSignature(cartA) === getLeadSignature(cartVariant) &&
    getLeadSignature(cartA) === getLeadSignature(cartReordered),
  "Slot #76: quantity, variant and ordering changes do not change the lead-time signature (lead time is per product)"
);
assert(
  getLeadSignature(cartA) !== getLeadSignature([...cartA, { productId: "p-new", quantity: 1 }]) &&
    getLeadSignature(cartA) !== getLeadSignature([cartA[0]]),
  "Slot #76: adding or removing a product changes the signature, so the slot is re-checked"
);
// 6. other reasons a stored slot can go stale
assert(
  (() => {
    const full = judge(SLOT_1230, 60, [SLOT_1230]);
    return !full.valid && full.reason === "SLOT_FULL";
  })(),
  "Slot #76: a slot that has filled up since it was chosen is reported as full"
);
const passed = judge(slotAt(10, 0), 0); // exactly now is still offered by available_slots
const longGone = judge("2026-11-09T06:30:00.000Z", 60); // yesterday: not offered even without lead time
assert(passed.valid === true, "Slot #76: a slot starting exactly now (no lead time) is still offered");
assert(!longGone.valid && longGone.reason === "SLOT_UNAVAILABLE", "Slot #76: a slot that is no longer offered at all (past / closed / outside hours) is reported as unavailable, not as a lead-time problem");
assert(
  (() => {
    const r = judge(SLOT_1230, 0);
    return r.valid;
  })(),
  "Slot #76: with no lead time the slot is judged only by availability"
);
assert(
  evaluateSelectedSlot({ slotStart: "not a date", requiredLeadMinutes: 60, slotsForCart: modelAvailableSlots(60), slotsAnyLead: modelAvailableSlots(0) }).valid === false,
  "Slot #76: an unparseable slot is never treated as valid"
);

// Messages: clear, no raw codes
const leadText = describeInvalidSlot("LEAD_TIME_NOT_MET", "Tue, 10 Nov · 12:30 PM – 1:00 PM", 240);
assert(
  /no longer available/.test(leadText) && /4 hours of preparation/.test(leadText) && /choose a later time/.test(leadText) && !/LEAD_TIME|_/.test(leadText),
  "Slot #76: the lead-time message explains what changed and what to do, without internal codes"
);
assert(/filled up/.test(describeInvalidSlot("SLOT_FULL", "x", 0)) && /no longer available/.test(describeInvalidSlot("SLOT_UNAVAILABLE", "x", 0)), "Slot #76: full and unavailable slots get their own readable messages");
assert(/45 minutes of preparation/.test(describeInvalidSlot("LEAD_TIME_NOT_MET", "x", 45)), "Slot #76: short lead times are described in minutes");

// Wiring (static): the server decides, the client only reacts
const pickupActionsSrc = fs.readFileSync(path.join(process.cwd(), "lib/pickup/actions.ts"), "utf8");
const cartContextSrc = fs.readFileSync(path.join(process.cwd(), "lib/cart/context.tsx"), "utf8");
assert(
  /\.strict\(\)/.test(pickupActionsSrc) && !/lead/i.test(pickupActionsSrc.slice(pickupActionsSrc.indexOf("validatePickupSlotSchema"), pickupActionsSrc.indexOf("export type ValidatePickupSlotResult"))),
  "Slot #76: the slot check accepts only product ids and a slot start: a client-supplied lead time or availability is impossible"
);
assert(
  /from\("products"\)[\s\S]*?lead_time_minutes[\s\S]*?\.is\("archived_at", null\)/.test(pickupActionsSrc) && /rpc\("available_slots"/.test(pickupActionsSrc) && /createAdminClient\(\)/.test(pickupActionsSrc),
  "Slot #76: lead time is read from the live products table and availability from the database's available_slots"
);
assert(!/\.(insert|update|delete|upsert)\(/.test(pickupActionsSrc) && /slotcheck:ip:/.test(pickupActionsSrc), "Slot #76: the slot check is read-only and rate limited");
assert(
  /getLeadSignature\(state\.items\)/.test(cartContextSrc) && /validatePickupSlotAction\(/.test(cartContextSrc) && /INVALIDATE_PICKUP_SLOT/.test(cartContextSrc) &&
    /\[isHydrated, leadSignature, selectedSlotStart\]/.test(cartContextSrc),
  "Slot #76: the cart re-checks the slot when its products change or a stored slot is restored"
);
const reducerInvalidate = cartContextSrc.slice(cartContextSrc.indexOf('case "INVALIDATE_PICKUP_SLOT"'), cartContextSrc.indexOf('case "CLEAR_PICKUP"'));
assert(
  /pickupSlot: null/.test(reducerInvalidate) && !/pickupDate/.test(reducerInvalidate.replace(/\/\/.*$/gm, "")),
  "Slot #76: an invalid slot is cleared but the chosen date is kept, and no other slot is picked for the customer"
);
assert(/pickupSlotNotice: action\.payload \? null : state\.pickupSlotNotice/.test(cartContextSrc), "Slot #76: choosing a new slot clears the notice");
assert(
  /isRetryOfUnconfirmedAttempt/.test(checkoutSrc) && /if \(!isRetryOfUnconfirmedAttempt\) \{[\s\S]*?validatePickupSlotAction\(/.test(checkoutSrc),
  "Slot #76: checkout checks the pickup time before placing the order, but not for a retry of an unconfirmed attempt (idempotent replay stays intact)"
);
assert(
  checkoutSrc.indexOf("validatePickupSlotAction(") < checkoutSrc.indexOf("await placeOrderAction("),
  "Slot #76: the pickup check runs before order creation is attempted"
);
assert(
  /PICKUP_TIME_CODES\.has\(actionResult\.code\)[\s\S]*?invalidatePickupSlot\(actionResult\.error\)/.test(checkoutSrc) &&
    ["LEAD_TIME_NOT_MET", "SLOT_FULL", "OUTSIDE_OPENING_HOURS", "CLOSED_DAY"].every((c) => checkoutSrc.includes(`"${c}"`)),
  "Slot #76: if the database still refuses the pickup time, the slot is cleared so the customer chooses again"
);
assert(/disabled=\{!isPickupValid \|\| isSubmitting \|\| hasCartIssues\}/.test(checkoutSrc), "Slot #76: the live-cart gate from #75 still blocks Place Order");

// --- Internal cake price-rule notes never reach customers (GitHub issue #72, customer side) ---
console.log("\n--- Internal Price-Rule Notes Stay Admin-Only: Customer Side (#72) ---");

// Compile-time guarantee (checked by `tsc --noEmit`): the customer type cannot carry internal fields.
const publicRuleShape: PriceTierRule = { id: "r1", tier_id: "t1", weight_grams: 500, egg_type: "EGG", finish: "STANDARD", price_paise: 50000, is_active: true };
// @ts-expect-error -- `note` is admin-only and is not part of the customer PriceTierRule type
void publicRuleShape.note;
// @ts-expect-error -- `verified` is admin-only and is not part of the customer PriceTierRule type
void publicRuleShape.verified;
const adminRuleShape: AdminPriceTierRule = { ...publicRuleShape, note: "Checking", verified: false };
assert(
  !("note" in publicRuleShape) && !("verified" in publicRuleShape) && adminRuleShape.note === "Checking" && adminRuleShape.verified === false,
  "Notes #72: the customer price-rule type has no note/verified; the admin type has both"
);

// Every price_tier_rules selection in the customer menu queries lists explicit, public columns only
const menuQueriesSrc72 = fs.readFileSync(path.join(process.cwd(), "lib/menu/queries.ts"), "utf8");
const ruleSelects72 = [...menuQueriesSrc72.matchAll(/price_tier_rules\s*\(([^)]*)\)/g)].map((m) => m[1]);
assert(
  ruleSelects72.length >= 2 && ruleSelects72.every((cols) => !/\bnote\b|\bverified\b|\*/.test(cols)),
  "Notes #72: customer menu queries never select note, verified or * from price_tier_rules",
  JSON.stringify(ruleSelects72)
);

// No customer-facing source reads or renders the internal fields
const customerDirs72 = ["app/menu", "components/menu", "components/cart", "components/checkout", "lib/menu", "lib/cart", "lib/orders"];
const listFiles72 = (dir: string): string[] =>
  fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles72(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []
  );
const offenders72 = customerDirs72
  .flatMap(listFiles72)
  .filter((f) => {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    return /(rule|Rule|r)\??\.(note|verified)\b/.test(src) || /price_tier_rules\s*\(\s*\*/.test(src);
  });
assert(offenders72.length === 0, "Notes #72: no customer-facing file reads a price rule's note/verified or selects price_tier_rules(*)", JSON.stringify(offenders72));

const cakeConfiguratorSrc72 = fs.readFileSync(path.join(process.cwd(), "components/menu/cake-configurator.tsx"), "utf8");
assert(!/\.note\b/.test(cakeConfiguratorSrc72) && !/verified/.test(cakeConfiguratorSrc72), "Notes #72: the cake configurator no longer renders a rule note");

// Admin keeps the internal fields through its own type
const adminTiersSrc72 = fs.readFileSync(path.join(process.cwd(), "components/admin/admin-cake-tiers-view.tsx"), "utf8");
const adminPricingSrc72 = fs.readFileSync(path.join(process.cwd(), "components/admin/admin-product-pricing-view.tsx"), "utf8");
assert(
  [adminTiersSrc72, adminPricingSrc72].every(
    (src) => /import type \{[^}]*\bAdminPriceTierRule\b[^}]*\} from "@\/lib\/admin\/types"/.test(src) && !/\bPriceTierRule\b(?!Action)/.test(src.replace(/AdminPriceTierRule/g, "")) && /rule\.note/.test(src)
  ),
  "Notes #72: both admin pricing screens use the admin rule type and still show the note"
);

// --- Menu cards must not offer products whose variants are all unavailable (GitHub issue #77) ---
console.log("\n--- Unavailable Variants Cannot Be Added (#77) ---");

const mkVariant = (id: string, over: Partial<{ is_available: boolean; price_paise: number; archived_at: string | null; sort_order: number }> = {}) => ({
  id,
  is_available: true,
  price_paise: 5000,
  archived_at: null as string | null,
  sort_order: 0,
  ...over,
});
const mkProduct = (variants: ReturnType<typeof mkVariant>[] | null, over: Partial<{ is_available: boolean; orderable_online: boolean }> = {}) => ({
  is_available: true,
  orderable_online: true,
  product_variants: variants,
  ...over,
});
// Mirrors lib/menu/queries.ts calculateStartingPricePaise: it deliberately falls back to the
// prices of unavailable variants (so the card can still show a "from" price), which is why the
// starting price must never decide whether a product with variants can be ordered.
const startingFor = (variants: ReturnType<typeof mkVariant>[]) => {
  const pool = variants.filter((v) => v.is_available).length > 0 ? variants.filter((v) => v.is_available) : variants;
  const prices = pool.map((v) => v.price_paise).filter((x) => x > 0);
  return prices.length ? Math.min(...prices) : null;
};

// 1. all variants unavailable: the exact bug
const allOff = [mkVariant("v1", { is_available: false }), mkVariant("v2", { is_available: false, price_paise: 7000 })];
const allOffSel = resolveSimpleProductSelection({ product: mkProduct(allOff), selectedVariantId: "v1", startingPricePaise: startingFor(allOff) });
assert(startingFor(allOff) === 5000, "Variants #77: (precondition) the starting price still falls back to unavailable variants");
assert(allOffSel.canOrder === false && allOffSel.activeVariant === undefined && allOffSel.pricePaise === null, "Variants #77: all variants unavailable -> nothing can be added and no variant-less price is used");
assert(allOffSel.purchaseState === "VARIANTS_UNAVAILABLE", "Variants #77: all variants unavailable -> the card state is 'variants unavailable'");
// 2. some unavailable: the available one stays selectable and addable
const someOff = [mkVariant("v1", { is_available: false, sort_order: 1 }), mkVariant("v2", { price_paise: 7000, sort_order: 2 }), mkVariant("v3", { price_paise: 9000, sort_order: 3 })];
const someSel = resolveSimpleProductSelection({ product: mkProduct(someOff), selectedVariantId: "v3", startingPricePaise: startingFor(someOff) });
assert(someSel.canOrder && someSel.activeVariant?.id === "v3" && someSel.pricePaise === 9000 && someSel.purchaseState === "AVAILABLE", "Variants #77: some variants available -> an available variant can be selected and added");
assert(getOrderableVariants(someOff).map((v) => v.id).join() === "v2,v3", "Variants #77: unavailable variants are not offered for selection");
// 2b. a chosen variant that becomes unavailable is NEVER silently replaced by another one
const initialDefault = resolveSimpleProductSelection({ product: mkProduct(someOff), selectedVariantId: "", startingPricePaise: startingFor(someOff) });
assert(initialDefault.activeVariant?.id === "v2" && !initialDefault.selectionInvalid && initialDefault.canOrder, "Variants #77: with nothing chosen yet, the first orderable variant is the default");
const chosenStillOk = resolveSimpleProductSelection({ product: mkProduct(someOff), selectedVariantId: "v3", startingPricePaise: startingFor(someOff) });
assert(chosenStillOk.activeVariant?.id === "v3" && !chosenStillOk.selectionInvalid && chosenStillOk.pricePaise === 9000 && chosenStillOk.canOrder, "Variants #77: a chosen variant that is still available stays selected (normal behaviour preserved)");
// Large (v3, 9000) was chosen, then switched off while Regular-like v2 (7000) stays available
const largeSwitchedOff = [mkVariant("v1", { is_available: false, sort_order: 1 }), mkVariant("v2", { price_paise: 7000, sort_order: 2 }), mkVariant("v3", { price_paise: 9000, is_available: false, sort_order: 3 })];
const pickedOff = resolveSimpleProductSelection({ product: mkProduct(largeSwitchedOff), selectedVariantId: "v3", startingPricePaise: 7000 });
assert(
  pickedOff.selectionInvalid === true && pickedOff.activeVariant === undefined && pickedOff.pricePaise === null && pickedOff.canOrder === false,
  "Variants #77: the chosen variant becomes unavailable -> selection is invalid, NOT replaced by another variant, no price, cannot add"
);
assert(pickedOff.orderableVariants.map((v) => v.id).join() === "v2", "Variants #77: the remaining available variant is still offered for an explicit choice");
const reChosen = resolveSimpleProductSelection({ product: mkProduct(largeSwitchedOff), selectedVariantId: "v2", startingPricePaise: 7000 });
assert(!reChosen.selectionInvalid && reChosen.activeVariant?.id === "v2" && reChosen.pricePaise === 7000 && reChosen.canOrder, "Variants #77: after the customer explicitly chooses another variant it can be added");
const chosenRemoved = resolveSimpleProductSelection({ product: mkProduct([mkVariant("v2", { price_paise: 7000 })]), selectedVariantId: "gone", startingPricePaise: 7000 });
assert(chosenRemoved.selectionInvalid && !chosenRemoved.canOrder, "Variants #77: a chosen variant that no longer exists at all is also an invalid selection");
const allGoneAfterChoice = resolveSimpleProductSelection({ product: mkProduct(allOff), selectedVariantId: "v1", startingPricePaise: 5000 });
assert(!allGoneAfterChoice.selectionInvalid && !allGoneAfterChoice.canOrder && allGoneAfterChoice.purchaseState === "VARIANTS_UNAVAILABLE", "Variants #77: when NOTHING is orderable the product is 'variants unavailable' (not an invalid selection)");
assert(
  /"Large" is no longer available/.test(describeInvalidSelection("Large")) && /choose another option/i.test(describeInvalidSelection("Large")) && /option you chose is no longer available/.test(describeInvalidSelection(null)),
  "Variants #77: the invalid-selection message names the variant (or falls back gracefully) and asks for an explicit choice"
);
// 3. product without variants keeps its product-level behaviour
const noVariantsPriced = resolveSimpleProductSelection({ product: mkProduct([]), selectedVariantId: "", startingPricePaise: 4500 });
assert(hasAnyVariants([]) === false && noVariantsPriced.pricePaise === 4500 && noVariantsPriced.canOrder, "Variants #77: a product with no variants but a price keeps its existing behaviour");
assert(!resolveSimpleProductSelection({ product: mkProduct(null), selectedVariantId: "", startingPricePaise: null }).canOrder, "Variants #77: a product with no variants and no price still cannot be added");
// 4. product itself unavailable / in-store only
const productOff = resolveSimpleProductSelection({ product: mkProduct([mkVariant("v1")], { is_available: false }), selectedVariantId: "v1", startingPricePaise: 5000 });
assert(productOff.purchaseState === "PRODUCT_UNAVAILABLE" && !productOff.canOrder, "Variants #77: a product that is switched off cannot be added even if its variant is available");
const inStore = resolveSimpleProductSelection({ product: mkProduct([mkVariant("v1")], { orderable_online: false }), selectedVariantId: "v1", startingPricePaise: 5000 });
assert(inStore.purchaseState === "IN_STORE_ONLY" && !inStore.canOrder, "Variants #77: an in-store-only product still cannot be added online");
// 5. archived and unpriced variants
const archivedOnly = [mkVariant("v1", { archived_at: "2026-11-01T00:00:00Z" })];
assert(!hasAnyVariants(archivedOnly) && !getOrderableVariants(archivedOnly).length, "Variants #77: archived variants are neither offered nor counted as variants");
assert(getOrderableVariants([mkVariant("v1", { price_paise: 0 })]).length === 0, "Variants #77: a variant without a price cannot be ordered");
const mixedArchived = [mkVariant("v1", { archived_at: "2026-11-01T00:00:00Z" }), mkVariant("v2", { is_available: false })];
assert(getSimpleProductPurchaseState(mkProduct(mixedArchived)) === "VARIANTS_UNAVAILABLE", "Variants #77: archived + unavailable variants together still count as 'has variants, none orderable'");
// 6. the variant becomes unavailable while the menu is open: re-resolving with fresh data blocks it
const openMenuBefore = [mkVariant("v1"), mkVariant("v2", { sort_order: 1 })];
const openMenuAfter = [mkVariant("v1", { is_available: false }), mkVariant("v2", { is_available: false, sort_order: 1 })];
assert(
  resolveSimpleProductSelection({ product: mkProduct(openMenuBefore), selectedVariantId: "v1", startingPricePaise: 5000 }).canOrder === true &&
    resolveSimpleProductSelection({ product: mkProduct(openMenuAfter), selectedVariantId: "v1", startingPricePaise: 5000 }).canOrder === false,
  "Variants #77: when refreshed data shows every variant off, the same card can no longer be added"
);
// 7. messages
assert(
  /Veg Puff is no longer available/.test(describeUnavailableOnAdd("PRODUCT_UNAVAILABLE", "Veg Puff")) &&
    /That option for Veg Puff is no longer available/.test(describeUnavailableOnAdd("OPTION_NOT_AVAILABLE", "Veg Puff")) &&
    !/PRODUCT_|OPTION_/.test(describeUnavailableOnAdd("OPTION_NOT_AVAILABLE", "x")),
  "Variants #77: the 'no longer available' message names the item and has no internal codes"
);

// Wiring (static)
const cardSrc = fs.readFileSync(path.join(process.cwd(), "components/menu/product-card.tsx"), "utf8");
const pickerSrc = fs.readFileSync(path.join(process.cwd(), "components/menu/product-variant-picker.tsx"), "utf8");
const addCheckSrc = fs.readFileSync(path.join(process.cwd(), "lib/cart/add-check.ts"), "utf8");
const menuQueriesSrc = fs.readFileSync(path.join(process.cwd(), "lib/menu/queries.ts"), "utf8");
assert(
  /resolveSimpleProductSelection\(/.test(cardSrc) && /resolveSimpleProductSelection\(/.test(pickerSrc),
  "Variants #77: the menu card and the product page use the same availability decision"
);
assert(
  !/hasDefinedVariants = availableVariants\.length/.test(cardSrc) && !/\.filter\(\s*\(v\) => v\.is_available/.test(cardSrc) && !/\.filter\(\s*\(v\) => v\.is_available/.test(pickerSrc),
  "Variants #77: the old 'variants exist only if some are available' rule is gone from both components"
);
assert(
  cardSrc.indexOf("await checkItemBeforeAdd(") > 0 && cardSrc.indexOf("await checkItemBeforeAdd(") < cardSrc.indexOf("addItem({") &&
    pickerSrc.indexOf("await checkItemBeforeAdd(") > 0 && pickerSrc.indexOf("await checkItemBeforeAdd(") < pickerSrc.indexOf("addItem({"),
  "Variants #77: the server confirms the item before it is added to the cart (stale open menu)"
);
assert(
  /validateCartAction\(/.test(addCheckSrc) && /check\.status !== "OK"/.test(addCheckSrc) && /catch \{\s*return null;/.test(addCheckSrc),
  "Variants #77: the add-time check reuses the live cart check (#75) and never blocks when it cannot run (place_order still decides)"
);
assert(
  (menuQueriesSrc.match(/sort_order,\s*archived_at\s*\)/g) || []).length >= 2,
  "Variants #77: menu queries load archived_at for variants so archived ones are excluded"
);
assert(
  /disabled=\{!canAddToCart\}/.test(cardSrc) && /disabled=\{!canOrder\}/.test(cardSrc) && /Currently unavailable/.test(cardSrc) && /disabled=\{!canAddToCart\}/.test(pickerSrc),
  "Variants #77: Add and the quantity control are disabled and the card says it is unavailable"
);
assert(
  /useState<string>\(\s*\(\) => getOrderableVariants\(product\.product_variants\)\[0\]\?\.id \?\? ""/.test(cardSrc) &&
    /useState<string>\(\s*\(\) => getOrderableVariants\(variants\)\[0\]\?\.id \?\? ""/.test(pickerSrc),
  "Variants #77: the variant shown as selected is a real selection from the start (so a later swap can be detected)"
);
assert(
  /selection\.selectionInvalid/.test(cardSrc) && /selection\.selectionInvalid/.test(pickerSrc) &&
    /invalidSelectionMessage/.test(cardSrc) && /invalidSelectionMessage/.test(pickerSrc) && /role="alert"/.test(pickerSrc),
  "Variants #77: both the card and the product page show a message when the chosen variant became unavailable"
);
assert(
  /Select a size to continue/.test(pickerSrc) && /canAddToCart = selection\.canOrder && !isCheckingAdd/.test(pickerSrc),
  "Variants #77: Add to Cart on the product page stays disabled until a valid variant is chosen"
);
assert(
  /\(selectionInvalid && availableVariants\.length === 1\)/.test(cardSrc) && /selectionInvalid && availableVariants\.length > 0/.test(pickerSrc),
  "Variants #77: the variant choices are shown even when only ONE variant remains, so the customer can pick it explicitly"
);
// Accessibility (static): names and states of the controls say what is going on
assert(
  /aria-label=\{canOrder \? `Select quantity for \$\{product\.name\}` : orderBlockedLabel\}/.test(cardSrc) &&
    /is currently unavailable`/.test(cardSrc) && /is available in-store only`/.test(cardSrc) && /Choose an option for \$\{product\.name\} first/.test(cardSrc),
  "A11y #77: the disabled Add control says why the product cannot be ordered (unavailable / in-store / choose an option)"
);
assert(
  /aria-label=\{detailsLabel\}/.test(cardSrc) && /\(currently unavailable\)/.test(cardSrc) && /\(in-store only\)/.test(cardSrc),
  "A11y #77: the card link's accessible name includes the Unavailable / In-Store status that the visual badge shows"
);
assert(
  (cardSrc.match(/aria-pressed=\{isSelected\}/g) || []).length === 1 && (pickerSrc.match(/aria-pressed=\{isSelected\}/g) || []).length === 1,
  "A11y #77: variant choices expose which one is selected (aria-pressed)"
);

console.log("\n========================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("========================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
