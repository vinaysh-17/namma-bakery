"use client";

import * as React from "react";
import type {
  CartAction,
  CartContextValue,
  CartItem,
  CartState,
} from "./types";
import type { PickupSlot } from "@/lib/pickup/types";
import { getIstDateString } from "@/lib/utils/date";
import { calendarDateSchema } from "@/lib/validation/common";
import { validatePickupSlotAction } from "@/lib/pickup/actions";
import { describeInvalidSlot, getLeadSignature } from "@/lib/pickup/slot-validity";
import { formatPickupSelectionSummary } from "@/lib/pickup/utils";

const STORAGE_KEY = "namma-bakery-cart-v1";

const initialState: CartState = {
  items: [],
  pickupDate: null,
  pickupSlot: null,
  pickupSlotNotice: null,
};

function cartReducer(state: CartState, action: CartAction): CartState {
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
          quantity: existing.quantity + addQty,
        };
        return { ...state, items: nextItems };
      }

      const newItem: CartItem = {
        ...action.payload,
        quantity: addQty,
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
            ? { ...item, quantity: targetQty }
            : item
        ),
      };
    }
    case "INCREMENT_QUANTITY": {
      return {
        ...state,
        items: state.items.map((item) =>
          item.itemKey === action.payload.itemKey
            ? { ...item, quantity: item.quantity + 1 }
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

function validateCartItems(arr: unknown): CartItem[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((item): item is CartItem => {
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
  });
}

function parseStoredCart(raw: string | null): {
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

const CartContext = React.createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(cartReducer, initialState);
  const [isHydrated, setIsHydrated] = React.useState(false);

  // Rehydrate on client mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = parseStoredCart(stored);
      dispatch({ type: "INIT_CART", payload: parsed });
    } catch {
      // Ignore localStorage read failures
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // Sync state changes to localStorage once hydrated
  React.useEffect(() => {
    if (!isHydrated) return;
    try {
      const dataToStore = {
        items: state.items,
        pickupDate: state.pickupDate,
        pickupSlot: state.pickupSlot,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToStore));
    } catch {
      // Storage quota or privacy mode error handling
    }
  }, [state.items, state.pickupDate, state.pickupSlot, isHydrated]);

  // Slot guard (issue #76): whenever the products in the cart change, or a slot is restored
  // from storage / chosen, ask the server whether the slot is still valid for this cart. An
  // invalid slot is cleared with an explanation; the customer chooses again. Quantity and
  // variant changes do not change the lead time, so they do not trigger a check.
  const leadSignature = React.useMemo(() => getLeadSignature(state.items), [state.items]);
  const selectedSlotStart = state.pickupSlot?.slotStart ?? null;
  const slotCheckId = React.useRef(0);
  const latestPickup = React.useRef({
    pickupDate: state.pickupDate,
    slot: state.pickupSlot,
  });
  React.useEffect(() => {
    latestPickup.current = { pickupDate: state.pickupDate, slot: state.pickupSlot };
  }, [state.pickupDate, state.pickupSlot]);

  React.useEffect(() => {
    if (!isHydrated || !selectedSlotStart || !leadSignature) return;
    const id = ++slotCheckId.current;
    void validatePickupSlotAction({
      productIds: leadSignature.split("|"),
      slotStart: selectedSlotStart,
    })
      .then((result) => {
        if (id !== slotCheckId.current) return; // a newer check superseded this one
        if (!result.success || result.valid) return; // valid, or could not check: the server still decides at checkout
        const current = latestPickup.current;
        if (current.slot?.slotStart !== selectedSlotStart) return; // customer already changed it
        const summary = current.pickupDate
          ? formatPickupSelectionSummary(current.pickupDate, current.slot.formattedTime)
          : current.slot.formattedTime;
        dispatch({
          type: "INVALIDATE_PICKUP_SLOT",
          payload: {
            message: describeInvalidSlot(result.reason, summary, result.requiredLeadMinutes),
          },
        });
      })
      .catch(() => {
        // Network failure: leave the slot; place_order remains the authority
      });
  }, [isHydrated, leadSignature, selectedSlotStart]);

  const invalidatePickupSlot = React.useCallback((message: string) => {
    dispatch({ type: "INVALIDATE_PICKUP_SLOT", payload: { message } });
  }, []);

  const addItem = React.useCallback(
    (item: Omit<CartItem, "quantity"> & { quantity?: number }) => {
      dispatch({ type: "ADD_ITEM", payload: item });
    },
    []
  );

  const removeItem = React.useCallback((itemKey: string) => {
    dispatch({ type: "REMOVE_ITEM", payload: { itemKey } });
  }, []);

  const updateQuantity = React.useCallback(
    (itemKey: string, quantity: number) => {
      dispatch({ type: "UPDATE_QUANTITY", payload: { itemKey, quantity } });
    },
    []
  );

  const incrementQuantity = React.useCallback((itemKey: string) => {
    dispatch({ type: "INCREMENT_QUANTITY", payload: { itemKey } });
  }, []);

  const decrementQuantity = React.useCallback((itemKey: string) => {
    dispatch({ type: "DECREMENT_QUANTITY", payload: { itemKey } });
  }, []);

  const applyLivePrices = React.useCallback(
    (updates: { itemKey: string; unitPricePaise: number }[]) => {
      dispatch({ type: "APPLY_LIVE_PRICES", payload: { updates } });
    },
    []
  );

  const removeItems = React.useCallback((itemKeys: string[]) => {
    dispatch({ type: "REMOVE_ITEMS", payload: { itemKeys } });
  }, []);

  const clearCart = React.useCallback(() => {
    dispatch({ type: "CLEAR_CART" });
  }, []);

  const setPickupDate = React.useCallback((date: string | null) => {
    dispatch({ type: "SET_PICKUP_DATE", payload: date });
  }, []);

  const setPickupSlot = React.useCallback((slot: PickupSlot | null) => {
    dispatch({ type: "SET_PICKUP_SLOT", payload: slot });
  }, []);

  const clearPickup = React.useCallback(() => {
    dispatch({ type: "CLEAR_PICKUP" });
  }, []);

  const itemCount = React.useMemo(() => {
    return state.items.reduce((sum, item) => sum + item.quantity, 0);
  }, [state.items]);

  const subtotalPaise = React.useMemo(() => {
    return state.items.reduce(
      (sum, item) => sum + item.unitPricePaise * item.quantity,
      0
    );
  }, [state.items]);

  const isEmpty = state.items.length === 0;

  const value = React.useMemo<CartContextValue>(
    () => ({
      items: state.items,
      itemCount,
      subtotalPaise,
      isEmpty,
      isHydrated,
      pickupDate: state.pickupDate,
      pickupSlot: state.pickupSlot,
      pickupSlotNotice: state.pickupSlotNotice,
      invalidatePickupSlot,
      addItem,
      removeItem,
      updateQuantity,
      incrementQuantity,
      decrementQuantity,
      applyLivePrices,
      removeItems,
      clearCart,
      setPickupDate,
      setPickupSlot,
      clearPickup,
    }),
    [
      state.items,
      state.pickupDate,
      state.pickupSlot,
      state.pickupSlotNotice,
      invalidatePickupSlot,
      itemCount,
      subtotalPaise,
      isEmpty,
      isHydrated,
      addItem,
      removeItem,
      updateQuantity,
      incrementQuantity,
      decrementQuantity,
      applyLivePrices,
      removeItems,
      clearCart,
      setPickupDate,
      setPickupSlot,
      clearPickup,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = React.useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
