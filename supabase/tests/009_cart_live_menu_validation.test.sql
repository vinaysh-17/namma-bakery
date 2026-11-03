-- Run with: supabase test db
-- Cart validated against the live menu (GitHub issue #75) - requires migration 0023.
-- Covers place_order (expected price check, unavailable items, idempotency interaction) and the
-- read-only check_cart_items function.
begin;
select plan(33);

create temp table ctx as
select (select id from locations limit 1) as loc,
       ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 12 hours') at time zone 'Asia/Kolkata') as pickup,
       (select p.id from products p join product_variants v on v.product_id = p.id
         where p.kind = 'SIMPLE' and p.orderable_online and p.archived_at is null and p.is_available and v.archived_at is null and v.is_available
         order by p.sort_order limit 1) as simple_id,
       (select v.id from products p join product_variants v on v.product_id = p.id
         where p.kind = 'SIMPLE' and p.orderable_online and p.archived_at is null and p.is_available and v.archived_at is null and v.is_available
         order by p.sort_order limit 1) as variant_id,
       (select id from products where slug = 'black-forest') as cake_id;
grant select on ctx to anon, authenticated, service_role;

-- live prices, read as the owner before any change
create temp table live as
select (select price_paise from product_variants where id = (select variant_id from ctx)) as variant_price,
       (select r.price_paise from price_tier_rules r join products p on p.price_tier_id = r.tier_id
         where p.id = (select cake_id from ctx) and r.weight_grams = 1000 and r.egg_type = 'EGGLESS' and r.finish = 'STANDARD' and r.is_active) as cake_price;
grant select on live to service_role;

-- helpers: cart items with an optional "price the customer saw"
create function pg_temp.simple_item(p_expected int default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('product_id', (select simple_id from ctx), 'variant_id', (select variant_id from ctx),
                                              'quantity', 2, 'expected_unit_price_paise', p_expected))
$$;
create function pg_temp.cake_item(p_expected int default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('product_id', (select cake_id from ctx), 'weight_grams', 1000, 'egg_type', 'EGGLESS',
                                              'quantity', 1, 'expected_unit_price_paise', p_expected))
$$;
grant execute on function pg_temp.simple_item(int), pg_temp.cake_item(int) to service_role;

create temp table results (label text, order_id uuid, order_number text, public_token text, replayed boolean);
grant all on results to service_role;

set local role service_role;

-- 1. a current cart (expected prices equal the live prices) is accepted and priced from the catalog
insert into results select 'valid', * from place_order((select loc from ctx), null, 'Live Menu', '9845200001', null, (select pickup from ctx), null,
  jsonb_build_array(pg_temp.simple_item((select variant_price from live)), pg_temp.cake_item((select cake_price from live))));
select is((select total_paise from orders where customer_phone = '9845200001'),
          2 * (select variant_price from live) + (select cake_price from live),
          'current cart: order is created and priced from the live catalog');

-- 2. a cart without expected prices still works (backward compatible)
insert into results select 'noexpected', * from place_order((select loc from ctx), null, 'Live Menu', '9845200002', null, (select pickup from ctx), null,
  jsonb_build_array(pg_temp.simple_item()));
select is((select total_paise from orders where customer_phone = '9845200002'), 2 * (select variant_price from live),
          'cart without expected prices behaves exactly as before');

-- 3. a client-supplied price field cannot determine the final price
insert into results select 'forged', * from place_order((select loc from ctx), null, 'Live Menu', '9845200003', null, (select pickup from ctx), null,
  jsonb_build_array(pg_temp.simple_item() || '{"unit_price_paise": 1, "price_paise": 1, "total_paise": 1}'::jsonb));
select is((select total_paise from orders where customer_phone = '9845200003'), 2 * (select variant_price from live),
          'forged client price fields are ignored: the catalog price is charged');

-- 4. a stale (wrong) expected price is refused and NOTHING is created
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'Live Menu', '9845200004', null, (select pickup from ctx), null,
       jsonb_build_array(pg_temp.simple_item((select variant_price from live) - 100))) $$,
  'P0001', null, 'a stale expected price is refused');
select is((select count(*)::int from orders where customer_phone = '9845200004'), 0, 'refused stale price: no order was created');
select is((select count(*)::int from order_items oi join orders o on o.id = oi.order_id where o.customer_phone = '9845200004'), 0, 'refused stale price: no order items were created');
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Live Menu', '9845200004', null, (select pickup from ctx), null,
       jsonb_build_array(pg_temp.simple_item((select variant_price from live) + 100))) $$,
  'PRICE_CHANGED: %', 'a price that is too HIGH is refused too (the customer is told either way)');

-- 5. a stale cake price (cakes are priced from tier rules) is refused
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Live Menu', '9845200005', null, (select pickup from ctx), null,
       jsonb_build_array(pg_temp.cake_item((select cake_price from live) - 500))) $$,
  'PRICE_CHANGED: %', 'a stale cake price is refused');

-- 6. variant price changes while the cart is open
reset role;
update product_variants set price_paise = price_paise + 1000 where id = (select variant_id from ctx);
set local role service_role;
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Live Menu', '9845200006', null, (select pickup from ctx), null,
       jsonb_build_array(pg_temp.simple_item((select variant_price from live)))) $$,
  'PRICE_CHANGED: %', 'variant price changed after the item was added: order refused with the product name');
select is((select count(*)::int from orders where customer_phone = '9845200006'), 0, 'variant price change: no order was created');
insert into results select 'newprice', * from place_order((select loc from ctx), null, 'Live Menu', '9845200006', null, (select pickup from ctx), null,
  jsonb_build_array(pg_temp.simple_item((select variant_price from live) + 1000)));
select is((select total_paise from orders where customer_phone = '9845200006'), 2 * ((select variant_price from live) + 1000),
          'after the customer accepts the new price the order is charged the live price');

-- 7. the idempotency key is NOT consumed by a refused (stale) attempt
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Key Customer', '9845200007', null, (select pickup from ctx), null,
       jsonb_build_array(pg_temp.simple_item((select variant_price from live))), 'live-menu-attempt-key-01') $$,
  'PRICE_CHANGED: %', 'a stale attempt with an idempotency key is refused');
select is((select count(*)::int from orders where idempotency_key = 'live-menu-attempt-key-01'), 0, 'the refused attempt did not store the idempotency key');
insert into results select 'key-ok', * from place_order((select loc from ctx), null, 'Key Customer', '9845200007', null, (select pickup from ctx), null,
  jsonb_build_array(pg_temp.simple_item((select variant_price from live) + 1000)), 'live-menu-attempt-key-01');
select is((select replayed from results where label = 'key-ok'), false, 'the same key can be used for the corrected order (it creates a new order, not a replay)');

-- 8. a replay of an order that was already placed returns it even though the price changed since
reset role;
update product_variants set price_paise = price_paise + 500 where id = (select variant_id from ctx);
set local role service_role;
select is(
  (select order_number from place_order((select loc from ctx), null, 'Key Customer', '9845200007', null, (select pickup from ctx), null,
     jsonb_build_array(pg_temp.simple_item((select variant_price from live) + 1000)), 'live-menu-attempt-key-01')),
  (select order_number from results where label = 'key-ok'),
  'retry after a lost response returns the original order even if the price changed afterwards');
select is((select count(*)::int from orders where idempotency_key = 'live-menu-attempt-key-01'), 1, 'the retry created no second order');

-- 9. selected variant becomes unavailable
reset role;
update product_variants set is_available = false where id = (select variant_id from ctx);
set local role service_role;
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Live Menu', '9845200008', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.simple_item())) $$,
  'OPTION_NOT_AVAILABLE: %', 'an unavailable variant is refused');
select is((select count(*)::int from orders where customer_phone = '9845200008'), 0, 'unavailable variant: no order was created');

-- 10. cake option that no longer exists
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Live Menu', '9845200009', null, (select pickup from ctx), null,
       jsonb_build_array(pg_temp.cake_item() || '{"weight_grams": 7777}'::jsonb)) $$,
  'OPTION_NOT_AVAILABLE: %', 'a cake size/option that is not on the menu is refused');

-- 11. product becomes unavailable / is archived / category hidden
reset role;
update product_variants set is_available = true where id = (select variant_id from ctx);
update products set is_available = false where id = (select simple_id from ctx);
set local role service_role;
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Live Menu', '9845200010', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.simple_item())) $$,
  'PRODUCT_UNAVAILABLE: %', 'an unavailable product is refused');

reset role;
update products set is_available = true, archived_at = now() where id = (select simple_id from ctx);
set local role service_role;
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Live Menu', '9845200011', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.simple_item())) $$,
  'PRODUCT_NOT_FOUND: %', 'an archived product is refused and named (not a generic error)');
select is((select count(*)::int from orders where customer_phone in ('9845200010', '9845200011')), 0, 'unavailable / archived product: no order was created');

-- 12. check_cart_items (read-only): reports what changed without writing anything
reset role;
update products set archived_at = null where id = (select simple_id from ctx);
set local role service_role;
select is((select item_status from check_cart_items(jsonb_build_array(pg_temp.simple_item(), pg_temp.cake_item())) where item_index = 0), 'OK', 'check_cart_items: a valid simple item is OK');
select is((select current_unit_price_paise from check_cart_items(jsonb_build_array(pg_temp.simple_item(), pg_temp.cake_item())) where item_index = 0),
          (select price_paise from product_variants where id = (select variant_id from ctx)),
          'check_cart_items: returns the current catalog price, not a client price');
select is((select current_unit_price_paise from check_cart_items(jsonb_build_array(pg_temp.simple_item(), pg_temp.cake_item())) where item_index = 1), (select cake_price from live), 'check_cart_items: cake price comes from the tier rule');

reset role;
update products set archived_at = now() where id = (select simple_id from ctx);
set local role service_role;
select is((select item_status || ':' || coalesce(item_name, '') from check_cart_items(jsonb_build_array(pg_temp.simple_item()))),
          'PRODUCT_NOT_FOUND:' || (select name from products where id = (select simple_id from ctx)),
          'check_cart_items: an archived product is PRODUCT_NOT_FOUND and still named');

reset role;
update products set archived_at = null where id = (select simple_id from ctx);
update product_variants set is_available = false where id = (select variant_id from ctx);
set local role service_role;
select is((select item_status from check_cart_items(jsonb_build_array(pg_temp.simple_item()))), 'OPTION_NOT_AVAILABLE', 'check_cart_items: an unavailable variant is OPTION_NOT_AVAILABLE');

reset role;
update product_variants set is_available = true where id = (select variant_id from ctx);
update categories set is_visible = false where id = (select category_id from products where id = (select simple_id from ctx));
set local role service_role;
select is((select item_status from check_cart_items(jsonb_build_array(pg_temp.simple_item()))), 'PRODUCT_UNAVAILABLE', 'check_cart_items: a product in a hidden category is PRODUCT_UNAVAILABLE (same as place_order)');
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Live Menu', '9845200012', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.simple_item())) $$,
  'PRODUCT_UNAVAILABLE: %', 'place_order agrees: a product in a hidden category is refused');

select is((select count(*)::int from orders where customer_phone in ('9845200012')), 0, 'the check and the refused order wrote no order');
select throws_ok($$ select * from check_cart_items('[]'::jsonb) $$, 'INVALID_ITEMS', 'check_cart_items rejects an empty cart');
reset role;

-- 13. browser roles cannot call either function
set local role anon;
select throws_ok($$ select * from check_cart_items('[]'::jsonb) $$, '42501', null, 'check_cart_items is not callable from the anon role');
reset role;
set local role authenticated;
select throws_ok($$ select * from check_cart_items('[]'::jsonb) $$, '42501', null, 'check_cart_items is not callable from the authenticated role');
reset role;

select * from finish();
rollback;
