-- Migration: 0011_list_orders_for_phone.sql
--
-- Why this migration is required ("Find My Orders" for guest customers):
--   * Guest orders have no auth user (orders.customer_id is null), and customers cannot read
--     `orders` under RLS. The only existing access path is token based (get_order_by_token /
--     find_order_token), which needs the order number the customer has forgotten.
--   * After a customer proves ownership of a phone number with Supabase Phone OTP, the server
--     needs to list that phone's orders and custom cake requests. The service role has no
--     table grants on `orders` (deliberate hardening), so the lookup must be a SECURITY DEFINER
--     function, exactly like the existing token functions.
--
-- Security model:
--   * Executable by service_role ONLY (never by anon / authenticated / the browser).
--   * The Next.js server calls it with the phone number taken from the verified Supabase
--     session (auth.users.phone) - never from a request body or URL.
--   * Phone matching uses the same convention as find_order_token: the last 10 digits.
--   * Returns only customer-safe fields (no internal notes, no staff data). Order tracking
--     tokens are returned for the caller's OWN orders so the existing /orders/[token] page
--     can be reused; custom cake requests are opened through the existing custom cake
--     tracker session, so no request token is returned.

create or replace function public.list_orders_for_phone(p_phone text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
begin
  -- Never match on short / empty input
  if length(v_phone) < 10 then
    return jsonb_build_object('orders', '[]'::jsonb, 'custom_requests', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_number', o.order_number,
               'public_token', o.public_token,
               'status', o.status,
               'created_at', o.created_at,
               'requested_pickup_at', o.requested_pickup_at,
               'total_paise', o.total_paise,
               'is_custom', o.custom_request_id is not null
             ) order by o.created_at desc)
      from (
        select * from orders
        where right(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 10) = v_phone
        order by created_at desc
        limit 50
      ) o
    ), '[]'::jsonb),
    'custom_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'request_number', r.request_number,
               'status', r.status,
               'created_at', r.created_at,
               'preferred_pickup_at', r.preferred_pickup_at,
               'flavour', r.flavour,
               'weight_grams', r.weight_grams,
               -- Once staff accept a request an order is created (orders.custom_request_id).
               -- Return its reference so the customer sees ONE custom cake with its order.
               'linked_order_number', lo.order_number,
               'linked_order_token', lo.public_token,
               'linked_order_status', lo.status
             ) order by r.created_at desc)
      from (
        select * from custom_cake_requests
        where right(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 10) = v_phone
        order by created_at desc
        limit 50
      ) r
      left join orders lo on lo.custom_request_id = r.id
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.list_orders_for_phone(text) from public, anon, authenticated;
grant execute on function public.list_orders_for_phone(text) to service_role;
