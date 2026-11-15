"use client";

import * as React from "react";
import type { CartContextValue, CartItem } from "./types";
import type { PickupSlot } from "@/lib/pickup/types";
import { validatePickupSlotAction } from "@/lib/pickup/actions";
import { describeInvalidSlot, getLeadSignature } from "@/lib/pickup/slot-validity";
import { formatPickupSelectionSummary } from "@/lib/pickup/utils";
import {
  STORAGE_KEY,
  cartReducer,
  initialCartState,
  parseStoredCart,
} from "./reducer";

export { MAX_QUANTITY_PER_ITEM } from "./reducer";

const CartContext = React.createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(cartReducer, initialCartState);
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
