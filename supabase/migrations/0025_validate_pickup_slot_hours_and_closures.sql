-- Migration: 0025_validate_pickup_slot_hours_and_closures.sql
--
-- GitHub issue #73: "Pickup slots can be offered outside configured hours or on closed days"
--
-- Prior to this migration, place_order had several gaps in pickup slot validation:
--   1. Weekly closed days: If no business_hours row existed for a weekday, the check
--      "not exists (select 1 from business_hours ... and v_local::time >= opens and v_local::time < closes)"
--      raised OUTSIDE_OPENING_HOURS instead of CLOSED_DAY.
--   2. Closing time overlap: The check only verified v_local::time < closes, allowing orders
--      where the slot extended beyond closing time (e.g. 21:15 when closing was 21:30 and slot was 30 mins).
--   3. Slot alignment: There was no check that the requested pickup time aligned to configured
--      slot boundaries (e.g. 10:17 could be submitted) or had zero seconds.
--   4. Slot capacity count: slot_order_count called slot_start(), which anchored to midnight rather
--      than business_hours.opens, diverging from available_slots() when opening times were not
--      multiples of slot_minutes from midnight.
--
-- This migration updates public.place_order:
--   - Validates special closures -> raises CLOSED_DAY.
--   - Validates weekday presence in business_hours -> raises CLOSED_DAY if closed.
--   - Validates zero seconds, opening bounds (start >= opens, start + slot_minutes <= closes),
--     and interval alignment relative to opens -> raises OUTSIDE_OPENING_HOURS.
--   - Uses p_pickup directly in slot_order_count() to match available_slots().
--   - Preserves all existing functionality: signature, return type, grants, idempotency replay (#98),
--     live cart item & price validation (#75), lead time, and error codes.

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
  v_expected int;
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
  -- It also runs BEFORE the item checks below, so a price change after the order was placed
  -- never turns a legitimate retry into an error (issue #75).
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

  -- 1. Special calendar closures
  if exists (select 1 from special_closures where location_id = loc.id and closure_date = v_local::date) then
    raise exception 'CLOSED_DAY';
  end if;

  -- 2. Weekly closed days (no business_hours entry for this weekday)
  if not exists (select 1 from business_hours where location_id = loc.id and weekday = extract(dow from v_local)::int) then
    raise exception 'CLOSED_DAY';
  end if;

  -- 3. Operating hours and slot alignment:
  --    Must have zero seconds, start at/after opens, end at/before closes,
  --    and align exactly to configured slot_minutes intervals anchored to opens.
  if extract(second from v_local) <> 0 then
    raise exception 'OUTSIDE_OPENING_HOURS';
  end if;

  if not exists (
    select 1 from business_hours
    where location_id = loc.id
      and weekday = extract(dow from v_local)::int
      and v_local >= (v_local::date + opens)
      and (v_local + make_interval(mins => s.slot_minutes)) <= (v_local::date + closes)
      and (extract(epoch from (v_local - (v_local::date + opens)))::int % (s.slot_minutes * 60)) = 0
  ) then
    raise exception 'OUTSIDE_OPENING_HOURS';
  end if;

  insert into orders (location_id, customer_id, customer_name, customer_phone, customer_email, requested_pickup_at, customer_notes, idempotency_key)
  values (loc.id, p_customer_id, trim(p_name), v_phone, nullif(trim(coalesce(p_email,'')), ''), p_pickup, nullif(trim(coalesce(p_notes,'')), ''), v_key)
  returning * into o;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'quantity')::int;
    if v_qty is null or v_qty not between 1 and 20 then raise exception 'INVALID_QUANTITY'; end if;

    select * into prod from products where id = (it->>'product_id')::uuid and archived_at is null;
    if not found then
      -- archived / removed product: name it (when the row still exists) so the customer knows which item
      raise exception 'PRODUCT_NOT_FOUND: %', coalesce((select name from products where id = (it->>'product_id')::uuid), '');
    end if;
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

    -- The price the customer saw is compared with the live price, never used as the price.
    -- A difference aborts the whole order (rolled back) so the customer can review it.
    v_expected := nullif(it->>'expected_unit_price_paise', '')::int;
    if v_expected is not null and v_expected <> v_unit then
      raise exception 'PRICE_CHANGED: %', prod.name;
    end if;

    insert into order_items (order_id, product_id, variant_id, price_rule_id, product_name, variant_label, egg_type, finish,
                             weight_grams, unit_price_paise, quantity, cake_message)
    values (o.id, prod.id, var.id, rule.id, prod.name, v_label, v_egg, v_fin, v_w, v_unit, v_qty,
            nullif(left(trim(coalesce(it->>'cake_message','')), 60), ''));

    v_total := v_total + v_unit * v_qty;
    v_lead  := greatest(v_lead, prod.lead_time_minutes);
  end loop;

  if p_pickup < now() + make_interval(mins => v_lead) then raise exception 'LEAD_TIME_NOT_MET'; end if;
  if slot_order_count(loc.id, p_pickup, s.slot_minutes, o.id) >= s.max_orders_per_slot then
    raise exception 'SLOT_FULL';
  end if;

  update orders set total_paise = v_total where id = o.id returning * into o;
  insert into order_status_history (order_id, from_status, to_status, changed_by, actor_role, note)
  values (o.id, null, 'PENDING', p_customer_id, 'CUSTOMER', 'Order placed');

  return query select o.id, o.order_number, o.public_token, false;
end $$;

-- Grants unchanged: browser roles can never call place_order (customer orders are placed by the server).
revoke execute on function public.place_order(uuid, uuid, text, text, text, timestamptz, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.place_order(uuid, uuid, text, text, text, timestamptz, text, jsonb, text)
  to service_role;

notify pgrst, 'reload schema';

