export interface MyOrderSummary {
  order_number: string;
  /** Capability token for the caller's OWN order; opens the existing /orders/[token] page */
  public_token: string;
  status: string;
  created_at: string;
  requested_pickup_at: string;
  total_paise: number;
  /** Order created from an accepted custom cake request */
  is_custom: boolean;
}

export interface MyCustomRequestSummary {
  request_number: string;
  status: string;
  created_at: string;
  preferred_pickup_at: string;
  flavour: string;
  weight_grams: number;
  /** Order created when staff accepted this request (one custom cake, two stages) */
  linked_order_number?: string | null;
  linked_order_token?: string | null;
  linked_order_status?: string | null;
}

export interface MyOrdersResult {
  authenticated: boolean;
  /** Masked verified phone, e.g. "+91 ••••• •3215" */
  maskedPhone?: string;
  orders?: MyOrderSummary[];
  customRequests?: MyCustomRequestSummary[];
  error?: string;
}
