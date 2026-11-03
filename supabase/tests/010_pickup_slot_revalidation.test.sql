-- Run with: supabase test db
-- Pickup slot revalidation after cart changes (GitHub issue #76). No new migration: this proves
-- that the existing database rules (place_order + available_slots) stay the final authority,
-- and that the storefront's server-side slot check can rely on available_slots.
begin;
select plan(19);

create temp table ctx as
select (select id from locations limit 1) as loc,
       ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 12 hours') at time zone 'Asia/Kolkata') as pickup,
       (((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 12 hours') at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')::date as pickup_date,
       (select p.id from products p join product_variants v on v.product_id = p.id
         where p.kind = 'SIMPLE' and p.orderable_online and p.archived_at is null and p.is_available and v.archived_at is null and v.is_available
         order by p.sort_order limit 1) as simple_id,
       (select v.id from products p join product_variants v on v.product_id = p.id
         where p.kind = 'SIMPLE' and p.orderable_online and p.archived_at is null and p.is_available and v.archived_at is null and v.is_available
         order by p.sort_order limit 1) as variant_id,
       (select id from products where slug = 'black-forest') as cake_id;
grant select on ctx to anon, authenticated, service_role;

create function pg_temp.simple_item(p_qty int default 1) returns jsonb language sql as $$
  select jsonb_build_object('product_id', (select simple_id from ctx), 'variant_id', (select variant_id from ctx), 'quantity', p_qty)
$$;
create function pg_temp.cake_item() returns jsonb language sql as $$
  select jsonb_build_object('product_id', (select cake_id from ctx), 'weight_grams', 1000, 'egg_type', 'EGGLESS', 'quantity', 1)
$$;
grant execute on function pg_temp.simple_item(int), pg_temp.cake_item() to service_role;

create temp table results (label text, order_id uuid, order_number text, public_token text, replayed boolean);
grant all on results to service_role;

-- lead times: the simple product needs 60 min, the cake is made to need MORE than the 3 days
-- until the chosen pickup (so the chosen slot is valid for the first cart and stale for the second)
update products set lead_time_minutes = 60 where id = (select simple_id from ctx);
update products set lead_time_minutes = 7200 where id = (select cake_id from ctx);

set local role service_role;

-- 1. the chosen slot is valid for the original cart
insert into results select 'simple', * from place_order((select loc from ctx), null, 'Slot Test', '9845300001', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.simple_item()));
select matches((select order_number from results where label = 'simple'), '^NB[0-9]+$', 'a valid slot still succeeds for the original cart');

-- 2. lead time does NOT depend on quantity: the same slot is still valid for 20 of the same product
insert into results select 'qty20', * from place_order((select loc from ctx), null, 'Slot Test', '9845300002', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.simple_item(20)));
select matches((select order_number from results where label = 'qty20'), '^NB[0-9]+$', 'increasing quantity does not change lead time: the slot stays valid');

-- 3. adding a product with a longer lead time makes the same slot invalid, and the database refuses it
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'Slot Test', '9845300003', null, (select pickup from ctx), null,
       jsonb_build_array(pg_temp.simple_item(), pg_temp.cake_item())) $$,
  'LEAD_TIME_NOT_MET', 'adding a longer-lead product: the stale slot is refused by place_order');
select is((select count(*)::int from orders where customer_phone = '9845300003'), 0, 'the refused stale slot created no order');
select is((select count(*)::int from order_items oi join orders o on o.id = oi.order_id where o.customer_phone = '9845300003'), 0, 'the refused stale slot created no order items');

-- 4. the idempotency key is not consumed by the refused attempt
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'Slot Test', '9845300004', null, (select pickup from ctx), null,
       jsonb_build_array(pg_temp.simple_item(), pg_temp.cake_item()), 'slot-revalidate-key-0001') $$,
  'LEAD_TIME_NOT_MET', 'a stale slot with an idempotency key is refused');
select is((select count(*)::int from orders where idempotency_key = 'slot-revalidate-key-0001'), 0, 'the refused attempt did not store the key');

-- 5. removing the long-lead product makes the slot valid again (same pickup time, same key)
insert into results select 'removed', * from place_order((select loc from ctx), null, 'Slot Test', '9845300004', null, (select pickup from ctx), null,
  jsonb_build_array(pg_temp.simple_item()), 'slot-revalidate-key-0001');
select is((select replayed from results where label = 'removed'), false, 'after removing the item the same slot works and creates the order');

-- 6. a different variant of the same product has the same lead time (lead time is per product)
select is((select lead_time_minutes from products where id = (select simple_id from ctx)), 60, 'lead time belongs to the product, not to the variant or quantity');

-- 7. available_slots (used by the storefront slot check) agrees with place_order
select is(
  (select count(*)::int from available_slots((select loc from ctx), (select pickup_date from ctx), 0) s where s.slot_start = (select pickup from ctx) and s.remaining > 0),
  1, 'available_slots offers the chosen slot when no lead time applies');
select is(
  (select count(*)::int from available_slots((select loc from ctx), (select pickup_date from ctx), 60) s where s.slot_start = (select pickup from ctx)),
  1, 'available_slots offers the slot for the 60-minute cart');
select is(
  (select count(*)::int from available_slots((select loc from ctx), (select pickup_date from ctx), 7200) s where s.slot_start = (select pickup from ctx)),
  0, 'available_slots no longer offers the slot once the cart needs more lead time (the signal the storefront uses)');

-- 8. a slot that fills up is refused and reported as full
reset role;
update store_settings set max_orders_per_slot = 1 where location_id = (select loc from ctx);
-- the earlier orders of this test already occupy the slot, so it is full for everyone
set local role service_role;
select is(
  (select remaining from available_slots((select loc from ctx), (select pickup_date from ctx), 0) s where s.slot_start = (select pickup from ctx)),
  0, 'available_slots reports a full slot with 0 remaining');
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'Slot Test', '9845300005', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.simple_item())) $$,
  'SLOT_FULL', 'a slot that has filled up is refused by place_order');
select is((select count(*)::int from orders where customer_phone = '9845300005'), 0, 'the full-slot refusal created no order');

-- 9. a replay of an order that itself fills the slot still returns that order (retry after a lost response)
select is(
  (select order_number from place_order((select loc from ctx), null, 'Slot Test', '9845300004', null, (select pickup from ctx), null,
     jsonb_build_array(pg_temp.simple_item()), 'slot-revalidate-key-0001')),
  (select order_number from results where label = 'removed'),
  'a retry of an order that already filled the slot returns it (replay is answered before the slot check)');
select is((select count(*)::int from orders where idempotency_key = 'slot-revalidate-key-0001'), 1, 'the replay created no second order');

-- 10. a pickup time outside opening hours or in the past is still refused by the database
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'Slot Test', '9845300006', null, now() - interval '1 hour', null, jsonb_build_array(pg_temp.simple_item())) $$,
  'P0001', null, 'a pickup time in the past is refused');
reset role;

-- 11. browser roles still cannot call place_order
set local role anon;
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'X Y', '9845300007', null, (select pickup from ctx), null, '[]') $$,
  '42501', null, 'place_order is not callable from the browser role');
reset role;

select * from finish();
rollback;
