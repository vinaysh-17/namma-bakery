import type { CakeFinish, EggType } from "@/lib/menu/types";

export type OrderStatus =
  | "PENDING"
  | "ACCEPTED"
  | "PREPARING"
  | "READY_FOR_PICKUP"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED"
  | "NO_SHOW";

export type PaymentStatus =
  | "unpaid"
  | "payment_pending"
  | "paid"
  | "payment_failed"
  | "refunded";

export type PaymentMethod = "pay_at_store" | "online";

export interface PlaceOrderItemInput {
  productId: string;
  kind: "SIMPLE" | "TIERED_CAKE";
  variantId?: string;
  quantity: number;
  cakeConfig?: {
    weightGrams: number;
    eggType: EggType;
    finish: CakeFinish;
  };
  cakeMessage?: string;
  /** Price the customer saw (paise). Compared with the live price only, never used to price. */
  expectedUnitPricePaise?: number;
}

export interface PlaceOrderInput {
  customerDetails: {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    customerNotes?: string;
  };
  pickupSlotStart: string; // ISO 8601 string
  items: PlaceOrderItemInput[];
}

export type PlaceOrderResult =
  | {
      success: true;
      orderId: string;
      orderNumber: string;
      publicToken: string;
      /** True when this was a retry of an already-placed order (no new order was created) */
      replayed?: boolean;
    }
  | {
      success: false;
      error: string;
      code?: string;
    };

export interface OrderTrackItem {
  name: string;
  label?: string | null;
  egg_type?: EggType | null;
  quantity: number;
  line_total_paise: number;
  cake_message?: string | null;
}

export interface OrderStatusHistoryEntry {
  status: OrderStatus;
  at: string;
}

export interface OrderTrackDetails {
  order_number: string;
  status: OrderStatus;
  first_name: string;
  requested_pickup_at: string;
  confirmed_pickup_at: string | null;
  estimated_ready_at: string | null;
  bakery_note: string | null;
  rejection_reason: string | null;
  total_paise: number;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  items: OrderTrackItem[];
  history: OrderStatusHistoryEntry[];
}

/** Per-item result of checking a cart against the live menu. */
export type CartItemStatus =
  | "OK"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_UNAVAILABLE"
  | "OPTION_NOT_AVAILABLE";

export interface CartItemCheck {
  /** 0-based position of the item in the cart that was checked */
  index: number;
  status: CartItemStatus;
  productName: string | null;
  /** Authoritative current unit price; null when the item can't be ordered */
  currentUnitPricePaise: number | null;
}

export type ValidateCartResult =
  | { success: true; items: CartItemCheck[] }
  | { success: false; error: string };
