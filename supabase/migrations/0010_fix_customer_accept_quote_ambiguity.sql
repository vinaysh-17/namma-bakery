-- Migration: 0010_fix_customer_accept_quote_ambiguity.sql
--
-- Bug: public.customer_accept_quote(text) could never run. Its RETURNS TABLE columns
-- (order_number, public_token) are PL/pgSQL output variables, and the first statement
-- `select * into r from custom_cake_requests where public_token = p_token` references a
-- column with the same name, so PostgreSQL raised:
--   42702 column reference "public_token" is ambiguous
-- This broke accepting a quote for both customers and the Staff Portal
-- ("Accept Custom Cake & Confirm Schedule" -> "Failed to accept this request").
--
-- Fix: qualify the column with a table alias AND resolve name conflicts in favour of table
-- columns for this function (defence in depth). The body is
-- otherwise identical to 0002_functions.sql (same checks, same order/order_item/history
-- inserts), and the existing grants (service_role only) are preserved by CREATE OR REPLACE.

create or replace function public.customer_accept_quote(p_token text)
returns table (order_number text, public_token text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r custom_cake_requests; q custom_cake_quotes; s store_settings; loc locations; o orders; v_local_date date;
begin
  select * into r from custom_cake_requests c where c.public_token = p_token for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'QUOTED' then raise exception 'QUOTE_NOT_ACTIVE' using errcode = 'P0001'; end if;
  select * into q from custom_cake_quotes where request_id = r.id and superseded_at is null;
  if not found or q.valid_until < now() then raise exception 'QUOTE_EXPIRED' using errcode = 'P0001'; end if;

  select * into loc from locations where id = r.location_id;
  select * into s from store_settings where location_id = r.location_id for update;     -- serialise capacity checks
  v_local_date := (q.confirmed_pickup_at at time zone loc.timezone)::date;
  if (select count(*) from orders where location_id = r.location_id and custom_request_id is not null
        and status in ('PENDING','ACCEPTED','PREPARING','READY_FOR_PICKUP')
        and (coalesce(confirmed_pickup_at, requested_pickup_at) at time zone loc.timezone)::date = v_local_date) >= s.max_custom_per_day then
    raise exception 'DAY_FULL' using errcode = 'P0001';
  end if;

  insert into orders (location_id, customer_id, customer_name, customer_phone, customer_email, status, requested_pickup_at,
                      confirmed_pickup_at, estimated_ready_at, total_paise, customer_notes, bakery_note, custom_request_id)
  values (r.location_id, r.customer_id, r.customer_name, r.customer_phone, r.customer_email, 'ACCEPTED', q.confirmed_pickup_at,
          q.confirmed_pickup_at, q.confirmed_pickup_at, q.price_paise, left(r.additional_notes, 500), q.bakery_note, r.id)
  returning * into o;
  insert into order_items (order_id, product_name, variant_label, egg_type, weight_grams, unit_price_paise, quantity, cake_message)
  values (o.id, 'Custom cake: ' || r.flavour, (r.weight_grams::numeric / 1000)::text || ' kg, ' || lower(r.egg_type::text), r.egg_type, r.weight_grams, q.price_paise, 1, r.message_on_cake);
  insert into order_status_history (order_id, from_status, to_status, actor_role, note) values (o.id, null, 'ACCEPTED', 'CUSTOMER', 'Quote accepted');
  update custom_cake_requests set status = 'CUSTOMER_ACCEPTED' where id = r.id;
  return query select o.order_number, o.public_token;
end $$;
