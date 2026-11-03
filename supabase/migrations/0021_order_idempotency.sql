-- Migration: 0021_order_idempotency.sql
--
-- Makes order placement idempotent (GitHub issue #98: "Retrying after a network error can place
-- a duplicate order"). If the server commits an order but the response is lost, the customer's
-- retry used to call place_order again and create a SECOND order.
--
-- Fix: each checkout attempt carries an idempotency key.
--   * first request with key X  -> the order is created and stores X (orders.idempotency_key)
--   * replay with key X          -> NO new order; the existing order is returned (replayed = true)
--   * a different key Y          -> an independent, legitimate order
-- The protection lives in the database:
--   * a partial UNIQUE index guarantees one order per key even under a race, and
--   * place_order checks the key after the per-location store_settings lock, so concurrent
--     identical requests are serialised and the loser returns the winner's order.
-- A key can only be replayed with the same customer phone and pickup time; otherwise
-- IDEMPOTENCY_KEY_REUSED is raised, so a key can never be used to read someone else's order.
--
-- Backward compatible: p_idempotency_key defaults to NULL (no idempotency, as before), so the
-- existing 8-argument calls keep working. All existing validation, pricing, slot and limit
-- rules in place_order are unchanged.
--
-- The old 8-argument place_order is dropped and recreated with the extra parameter (a new
-- overload would make calls ambiguous). Its grants are re-applied: service_role ONLY.
-- Re-runnable. No existing data is modified (existing orders keep idempotency_key = NULL).

alter table public.orders add column if not exists idempotency_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_idempotency_key_format') then
    alter table public.orders add constraint orders_idempotency_key_format
      check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_-]{16,100}$');
  end if;
end $$;

create unique index if not exists orders_idempotency_key_uidx
  on public.orders (idempotency_key) where idempotency_key is not null;

drop function if exists public.place_order(uuid, uuid, text, text, text, timestamptz, text, jsonb);

create or replace function public.place_order(
  p_location_id uuid, p_customer_id uuid, p_name text, p_phone text, p_email text,
  p_pickup timestamptz, p_notes text, p_items jsonb, p_idempotency_key text default null)
returns table (order_id uuid, order_number text, public_token text, replayed boolean)
language plpgsql security definer set search_path = public as $$
declare
  loc locations; s store_settings; prod products; rule price_tier_rules; var product_variants;
  it jsonb; o orders;
  v_phone text := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g');
  v_qty int; v_unit int; v_label text; v_egg egg_type; v_fin cake_finish; v_w int;
  v_total int := 0; v_lead int := 0; v_local timestamp;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  ex orders;
begin
  if p_name is null or char_length(trim(p_name)) not between 2 and 80 then raise exception 'INVALID_NAME'; end if;
  if v_phone !~ '^\+?[0-9]{10,13}$' then raise exception 'INVALID_PHONE'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'INVALID_ITEMS'; end if;
  if v_key is not null and v_key !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;

  select * into loc from locations where id = p_location_id and is_active;
  if not found then raise exception 'LOCATION_NOT_FOUND'; end if;

  -- serialise concurrent orders for this location (prevents two customers taking the last slot)
  select * into s from store_settings where location_id = p_location_id for update;
  if not found then raise exception 'LOCATION_NOT_CONFIGURED'; end if;

  -- Idempotent replay: the same checkout attempt (same key) never creates a second order.
  -- This runs AFTER the store_settings row lock above, so two concurrent requests with the same
  -- key are serialised and the second one sees the first one's committed order. It also runs
  -- BEFORE the pause / open-orders / slot checks: the original order already counts towards
  -- those limits, so a replay must return it instead of failing against itself.
  if v_key is not null then
    select * into ex from orders where idempotency_key = v_key;
    if found then
      -- a key may only ever return the order of the SAME customer phone and pickup time
      if ex.customer_phone <> v_phone or ex.requested_pickup_at <> p_pickup then
        raise exception 'IDEMPOTENCY_KEY_REUSED';
      end if;
      return query select ex.id, ex.order_number, ex.public_token, true;
      return;
    end if;
  end if;

  if s.orders_paused_until is not null and s.orders_paused_until > now() then raise exception 'ORDERS_PAUSED'; end if;

  if (select count(*) from orders where customer_phone = v_phone and status = 'PENDING') >= s.max_open_orders_per_phone then
    raise exception 'TOO_MANY_OPEN_ORDERS';
  end if;

  v_local := p_pickup at time zone loc.timezone;
  if exists (select 1 from special_closures where location_id = loc.id and closure_date = v_local::date) then raise exception 'CLOSED_DAY'; end if;
  if not exists (select 1 from business_hours where location_id = loc.id and weekday = extract(dow from v_local)::int
                 and v_local::time >= opens and v_local::time < closes) then
    raise exception 'OUTSIDE_OPENING_HOURS';
  end if;

  insert into orders (location_id, customer_id, customer_name, customer_phone, customer_email, requested_pickup_at, customer_notes, idempotency_key)
  values (loc.id, p_customer_id, trim(p_name), v_phone, nullif(trim(coalesce(p_email,'')), ''), p_pickup, nullif(trim(coalesce(p_notes,'')), ''), v_key)
  returning * into o;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'quantity')::int;
    if v_qty is null or v_qty not between 1 and 20 then raise exception 'INVALID_QUANTITY'; end if;

    select * into prod from products where id = (it->>'product_id')::uuid and archived_at is null;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if not prod.is_available or not prod.orderable_online then raise exception 'PRODUCT_UNAVAILABLE: %', prod.name; end if;

    rule := null; var := null; v_egg := null; v_fin := null; v_w := null;
    if prod.kind = 'TIERED_CAKE' then
      v_w   := (it->>'weight_grams')::int;
      v_egg := (it->>'egg_type')::egg_type;
      v_fin := coalesce(it->>'finish', 'STANDARD')::cake_finish;
      select * into rule from price_tier_rules
       where tier_id = prod.price_tier_id and weight_grams = v_w and egg_type = v_egg and finish = v_fin and is_active;
      if not found then raise exception 'OPTION_NOT_AVAILABLE: %', prod.name; end if;
      v_unit := rule.price_paise;
      v_label := (v_w::numeric / 1000)::text || ' kg, ' || lower(v_egg::text) || case when v_fin <> 'STANDARD' then ', ' || replace(lower(v_fin::text),'_',' ') else '' end;
    else
      select * into var from product_variants
       where id = (it->>'variant_id')::uuid and product_id = prod.id and is_available and archived_at is null;
      if not found then raise exception 'OPTION_NOT_AVAILABLE: %', prod.name; end if;
      v_unit := var.price_paise; v_label := var.label;
    end if;

    insert into order_items (order_id, product_id, variant_id, price_rule_id, product_name, variant_label, egg_type, finish,
                             weight_grams, unit_price_paise, quantity, cake_message)
    values (o.id, prod.id, var.id, rule.id, prod.name, v_label, v_egg, v_fin, v_w, v_unit, v_qty,
            nullif(left(trim(coalesce(it->>'cake_message','')), 60), ''));

    v_total := v_total + v_unit * v_qty;
    v_lead  := greatest(v_lead, prod.lead_time_minutes);
  end loop;

  if p_pickup < now() + make_interval(mins => v_lead) then raise exception 'LEAD_TIME_NOT_MET'; end if;
  if slot_order_count(loc.id, slot_start(p_pickup, s.slot_minutes, loc.timezone), s.slot_minutes, o.id) >= s.max_orders_per_slot then
    raise exception 'SLOT_FULL';
  end if;

  update orders set total_paise = v_total where id = o.id returning * into o;
  insert into order_status_history (order_id, from_status, to_status, changed_by, actor_role, note)
  values (o.id, null, 'PENDING', p_customer_id, 'CUSTOMER', 'Order placed');

  return query select o.id, o.order_number, o.public_token, false;
end $$;

-- Grants: browser roles can never call place_order (customer orders are placed by the server).
revoke execute on function public.place_order(uuid, uuid, text, text, text, timestamptz, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.place_order(uuid, uuid, text, text, text, timestamptz, text, jsonb, text)
  to service_role;

notify pgrst, 'reload schema';
