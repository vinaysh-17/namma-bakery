import type { CakeFinish, EggType } from "@/lib/menu/types";
import type { PickupSlot } from "@/lib/pickup/types";

export interface CakeConfiguration {
  weightGrams: number;
  eggType: EggType;
  finish: CakeFinish;
}

export interface CartItem {
  /**
   * Deterministic composite key:
   * For cakes: `cake:${productId}:${weightGrams}:${eggType}:${finish}`
   * For simple products: `simple:${productId}:${variantId ?? 'default'}`
   */
  itemKey: string;
  productId: string;
  productSlug: string;
  productName: string;
  productNameKn?: string | null;
  categorySlug: string;
  kind: "SIMPLE" | "TIERED_CAKE";

  // For SIMPLE products with variants
  variantId?: string;
  variantLabel?: string;

  // For TIERED_CAKE
  configuration?: CakeConfiguration;

  unitPricePaise: number;
  quantity: number;

  /**
   * Product preparation lead time in minutes (used for calculating earliest pickup slots)
   */
  leadTimeMinutes?: number;
}

export interface CartState {
  items: CartItem[];
  pickupDate: string | null;
  pickupSlot: PickupSlot | null;
  /**
   * Why the chosen pickup slot was cleared (issue #76), e.g. the cart now needs more
   * preparation time. In memory only (not saved); cleared when a new slot or date is chosen.
   */
  pickupSlotNotice: string | null;
}

export type CartAction =
  | { type: "ADD_ITEM"; payload: Omit<CartItem, "quantity"> & { quantity?: number } }
  | { type: "REMOVE_ITEM"; payload: { itemKey: string } }
  | { type: "UPDATE_QUANTITY"; payload: { itemKey: string; quantity: number } }
  | { type: "INCREMENT_QUANTITY"; payload: { itemKey: string } }
  | { type: "DECREMENT_QUANTITY"; payload: { itemKey: string } }
  | { type: "APPLY_LIVE_PRICES"; payload: { updates: { itemKey: string; unitPricePaise: number }[] } }
  | { type: "REMOVE_ITEMS"; payload: { itemKeys: string[] } }
  | { type: "CLEAR_CART" }
  | {
      type: "INIT_CART";
      payload: {
        items: CartItem[];
        pickupDate?: string | null;
        pickupSlot?: PickupSlot | null;
      };
    }
  | { type: "SET_PICKUP_DATE"; payload: string | null }
  | { type: "SET_PICKUP_SLOT"; payload: PickupSlot | null }
  | { type: "CLEAR_PICKUP" }
  | { type: "INVALIDATE_PICKUP_SLOT"; payload: { message: string } };

export interface CartContextValue {
  items: CartItem[];
  itemCount: number;
  subtotalPaise: number;
  isEmpty: boolean;
  isHydrated: boolean;
  pickupDate: string | null;
  pickupSlot: PickupSlot | null;
  /** Explains why the pickup slot was cleared; null when there is nothing to tell the customer */
  pickupSlotNotice: string | null;
  /**
   * Clears the chosen slot (keeping the chosen date) and tells the customer why. The customer
   * must choose a new slot; nothing is picked for them.
   */
  invalidatePickupSlot: (message: string) => void;
  addItem: (item: Omit<CartItem, "quantity"> & { quantity?: number }) => void;
  removeItem: (itemKey: string) => void;
  updateQuantity: (itemKey: string, quantity: number) => void;
  incrementQuantity: (itemKey: string) => void;
  decrementQuantity: (itemKey: string) => void;
  /** Replace saved unit prices with the current menu prices (after the customer reviewed them) */
  applyLivePrices: (updates: { itemKey: string; unitPricePaise: number }[]) => void;
  /** Remove several cart lines at once (e.g. items that are no longer available) */
  removeItems: (itemKeys: string[]) => void;
  clearCart: () => void;
  setPickupDate: (date: string | null) => void;
  setPickupSlot: (slot: PickupSlot | null) => void;
  clearPickup: () => void;
}
