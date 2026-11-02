-- 0020: Let the customer custom cake pages read the order a request became (#62).
--
-- Once the bakery accepts a request, an order is created and the request stays
-- CUSTOMER_ACCEPTED for good. The order carries the real progress (ready, collected,
-- cancelled, no-show) and the confirmed pickup time, but the customer tracker and
-- confirmation page only looked at the request, so they kept saying "Confirmed" after the
-- order was cancelled and showed the requested pickup time instead of the confirmed one.
--
-- Those pages read through the server's service-role client, which had no access to
-- orders. Grant it only the columns the pages show: no customer details, notes or amounts.

grant select (custom_request_id, order_number, public_token, status, requested_pickup_at, confirmed_pickup_at)
  on table public.orders to service_role;
