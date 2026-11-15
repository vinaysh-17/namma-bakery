import type { CartAction, CartItem, CartState } from "./types";
import type { PickupSlot } from "@/lib/pickup/types";
import { getIstDateString } from "@/lib/utils/date";
import { calendarDateSchema } from "@/lib/validation/common";

/**
 * Pure cart state logic, deliberately separate from CartProvider (lib/cart/context.tsx):
 * this file has no "use client" / React / server-action dependency, so it can be
 * unit-tested directly (including from an offline Node script) without pulling in
 * "server-only"-guarded modules transitively imported by the provider.
 */

export const STORAGE_KEY = "namma-bakery-cart-v1";

// Matches the database's per-line-item cap (order_items.quantity check (quantity between
// 1 and 20), enforced again in place_order). Clamping here (GitHub issue #96) means the
// cart can never reach a state that checkout would reject.
export const MAX_QUANTITY_PER_ITEM = 20;

export const initialCartState: CartState = {
  items: [],
  pickupDate: null,
  pickupSlot: null,
  pickupSlotNotice: null,
};

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "INIT_CART": {
      return {
        ...state,
        items: action.payload.items,
        pickupDate: action.payload.pickupDate ?? null,
        pickupSlot: action.payload.pickupSlot ?? null,
        pickupSlotNotice: null,
      };
    }
    case "ADD_ITEM": {
      const existingIndex = state.items.findIndex(
        (item) => item.itemKey === action.payload.itemKey
      );
      const addQty = Math.max(1, action.payload.quantity ?? 1);

      if (existingIndex > -1) {
        const nextItems = [...state.items];
        const existing = nextItems[existingIndex];
        nextItems[existingIndex] = {
          ...existing,
          quantity: Math.min(MAX_QUANTITY_PER_ITEM, existing.quantity + addQty),
        };
        return { ...state, items: nextItems };
      }

      const newItem: CartItem = {
        ...action.payload,
        quantity: Math.min(MAX_QUANTITY_PER_ITEM, addQty),
      };
      return {
        ...state,
        items: [...state.items, newItem],
      };
    }
    case "REMOVE_ITEM": {
      return {
        ...state,
        items: state.items.filter((item) => item.itemKey !== action.payload.itemKey),
      };
    }
    case "APPLY_LIVE_PRICES": {
      const byKey = new Map(
        action.payload.updates.map((u) => [u.itemKey, u.unitPricePaise])
      );
      return {
        ...state,
        items: state.items.map((item) => {
          const next = byKey.get(item.itemKey);
          return next === undefined ? item : { ...item, unitPricePaise: next };
        }),
      };
    }
    case "REMOVE_ITEMS": {
      const drop = new Set(action.payload.itemKeys);
      return {
        ...state,
        items: state.items.filter((item) => !drop.has(item.itemKey)),
      };
    }
    case "UPDATE_QUANTITY": {
      const targetQty = action.payload.quantity;
      if (targetQty <= 0) {
        return {
          ...state,
          items: state.items.filter((item) => item.itemKey !== action.payload.itemKey),
        };
      }
      return {
        ...state,
        items: state.items.map((item) =>
          item.itemKey === action.payload.itemKey
            ? { ...item, quantity: Math.min(MAX_QUANTITY_PER_ITEM, targetQty) }
            : item
        ),
      };
    }
    case "INCREMENT_QUANTITY": {
      return {
        ...state,
        items: state.items.map((item) =>
          item.itemKey === action.payload.itemKey
            ? { ...item, quantity: Math.min(MAX_QUANTITY_PER_ITEM, item.quantity + 1) }
            : item
        ),
      };
    }
    case "DECREMENT_QUANTITY": {
      return {
        ...state,
        items: state.items.map((item) =>
          item.itemKey === action.payload.itemKey
            ? { ...item, quantity: Math.max(1, item.quantity - 1) }
            : item
        ),
      };
    }
    case "SET_PICKUP_DATE": {
      const newDate = action.payload;
      // If date changes, invalidate the previously selected slot
      const nextSlot = state.pickupDate === newDate ? state.pickupSlot : null;
      return {
        ...state,
        pickupDate: newDate,
        pickupSlot: nextSlot,
        pickupSlotNotice: null,
      };
    }
    case "SET_PICKUP_SLOT": {
      return {
        ...state,
        pickupSlot: action.payload,
        // choosing a new slot answers the notice
        pickupSlotNotice: action.payload ? null : state.pickupSlotNotice,
      };
    }
    case "INVALIDATE_PICKUP_SLOT": {
      // Keep the chosen date; drop only the slot. The customer picks a new one themselves.
      return {
        ...state,
        pickupSlot: null,
        pickupSlotNotice: action.payload.message,
      };
    }
    case "CLEAR_PICKUP": {
      return {
        ...state,
        pickupDate: null,
        pickupSlot: null,
        pickupSlotNotice: null,
      };
    }
    case "CLEAR_CART": {
      return {
        ...state,
        items: [],
        pickupDate: null,
        pickupSlot: null,
        pickupSlotNotice: null,
      };
    }
    default:
      return state;
  }
}

export function validateCartItems(arr: unknown): CartItem[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((item): item is CartItem => {
      return (
        typeof item === "object" &&
        item !== null &&
        typeof item.itemKey === "string" &&
        typeof item.productId === "string" &&
        typeof item.productSlug === "string" &&
        typeof item.productName === "string" &&
        typeof item.categorySlug === "string" &&
        typeof item.unitPricePaise === "number" &&
        item.unitPricePaise >= 0 &&
        typeof item.quantity === "number" &&
        item.quantity > 0
      );
    })
    // Clamp quantities stored before the #96 cap existed, so a cart saved on an older
    // build never rehydrates back into an over-the-limit state.
    .map((item) => ({ ...item, quantity: Math.min(MAX_QUANTITY_PER_ITEM, item.quantity) }));
}

export function parseStoredCart(raw: string | null): {
  items: CartItem[];
  pickupDate: string | null;
  pickupSlot: PickupSlot | null;
} {
  const emptyResult = { items: [], pickupDate: null, pickupSlot: null };
  if (!raw) return emptyResult;

  try {
    const parsed = JSON.parse(raw);

    // Backward compatibility: If previous version stored just an array of CartItem[]
    if (Array.isArray(parsed)) {
      return {
        items: validateCartItems(parsed),
        pickupDate: null,
        pickupSlot: null,
      };
    }

    if (typeof parsed !== "object" || parsed === null) {
      return emptyResult;
    }

    const items = validateCartItems(parsed.items);

    // Validate pickupDate (must be YYYY-MM-DD and not in the past in Asia/Kolkata)
    let pickupDate: string | null = null;
    const todayStr = getIstDateString();

    if (
      typeof parsed.pickupDate === "string" &&
      calendarDateSchema.safeParse(parsed.pickupDate).success &&
      parsed.pickupDate >= todayStr
    ) {
      pickupDate = parsed.pickupDate;
    }

    // Validate pickupSlot
    let pickupSlot: PickupSlot | null = null;
    if (
      pickupDate &&
      typeof parsed.pickupSlot === "object" &&
      parsed.pickupSlot !== null &&
      typeof parsed.pickupSlot.slotStart === "string" &&
      typeof parsed.pickupSlot.formattedTime === "string"
    ) {
      // If today is selected, ensure slot has not already passed
      const slotStartTime = new Date(parsed.pickupSlot.slotStart).getTime();
      if (!Number.isNaN(slotStartTime) && slotStartTime > Date.now()) {
        pickupSlot = parsed.pickupSlot as PickupSlot;
      }
    }

    return {
      items,
      pickupDate,
      pickupSlot,
    };
  } catch {
    return emptyResult;
  }
}
