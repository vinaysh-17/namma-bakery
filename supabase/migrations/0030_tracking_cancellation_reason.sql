-- Migration 0030: Add cancellation_reason to get_order_by_token return value.
-- Issue #78: the customer tracking page cannot display why an order was cancelled
-- because the function omits the cancellation_reason column.
--
-- This is a CREATE OR REPLACE that preserves the existing function signature
-- (p_token text → jsonb), language, volatility, SECURITY DEFINER, search_path
-- and all existing return fields. The only change is adding 'cancellation_reason'.

create or replace function get_order_by_token(p_token text) returns jsonb
  language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'order_number',        o.order_number,
    'status',              o.status,
    'first_name',          split_part(o.customer_name, ' ', 1),
    'requested_pickup_at', o.requested_pickup_at,
    'confirmed_pickup_at', o.confirmed_pickup_at,
    'estimated_ready_at',  o.estimated_ready_at,
    'bakery_note',         o.bakery_note,
    'rejection_reason',    o.rejection_reason,
    'cancellation_reason', o.cancellation_reason,
    'total_paise',         o.total_paise,
    'payment_status',      o.payment_status,
    'payment_method',      o.payment_method,
    'items', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'name',             i.product_name,
          'label',            i.variant_label,
          'egg_type',         i.egg_type,
          'quantity',         i.quantity,
          'line_total_paise', i.line_total_paise,
          'cake_message',     i.cake_message
        )
      ) from order_items i where i.order_id = o.id),
      '[]'::jsonb
    ),
    'history', coalesce(
      (select jsonb_agg(
        jsonb_build_object('status', h.to_status, 'at', h.created_at)
        order by h.created_at
      ) from order_status_history h where h.order_id = o.id),
      '[]'::jsonb
    )
  )
  from orders o
  where o.public_token = p_token
$$;
