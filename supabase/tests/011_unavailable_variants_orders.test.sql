-- Run with: supabase test db
-- Unavailable variants cannot be ordered (GitHub issue #77). No new migration: this proves the
-- database stays the final authority when a stale menu card lets an unavailable item through.
-- Requires migration 0023 (check_cart_items) for the last group.
begin;
select plan(13);

create temp table ctx as
select (select id from locations limit 1) as loc,
       ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 12 hours') at time zone 'Asia/Kolkata') as pickup,
       (select p.id from products p join product_variants v on v.product_id = p.id
         where p.kind = 'SIMPLE' and p.orderable_online and p.archived_at is null and p.is_available and v.archived_at is null and v.is_available
         group by p.id, p.sort_order order by p.sort_order limit 1) as simple_id;
grant select on ctx to anon, authenticated, service_role;

-- make sure the product has two variants: the seeded one and a second one
insert into product_variants (product_id, label, price_paise, sort_order)
  select (select simple_id from ctx), 'Large', 9900, 99;
create temp table vars as
  select (select id from product_variants where product_id = (select simple_id from ctx) and label = 'Large') as large_id,
         (select id from product_variants where product_id = (select simple_id from ctx) and label <> 'Large' and archived_at is null order by sort_order limit 1) as first_id;
grant select on vars to service_role;

create function pg_temp.item(p_variant uuid) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('product_id', (select simple_id from ctx), 'variant_id', p_variant, 'quantity', 1))
$$;
grant execute on function pg_temp.item(uuid) to service_role;

set local role service_role;

-- 1. some variants unavailable: the available one can still be ordered
reset role;
update product_variants set is_available = false where id = (select first_id from vars);
set local role service_role;
select lives_ok(
  $$ select place_order((select loc from ctx), null, 'Variant Test', '9845400001', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.item((select large_id from vars)))) $$,
  'with one variant unavailable the available variant can still be ordered');

-- 2. the unavailable variant itself is refused (a stale menu card still showing it)
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Variant Test', '9845400002', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.item((select first_id from vars)))) $$,
  'OPTION_NOT_AVAILABLE: %', 'an unavailable variant is refused');
select is((select count(*)::int from orders where customer_phone = '9845400002'), 0, 'no order was created for the unavailable variant');

-- 3. all variants unavailable
reset role;
update product_variants set is_available = false where product_id = (select simple_id from ctx);
set local role service_role;
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Variant Test', '9845400003', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.item((select large_id from vars)))) $$,
  'OPTION_NOT_AVAILABLE: %', 'when every variant is unavailable the product cannot be ordered');

-- 4. the bug case: a card that sent the product with NO variant (because it believed the product had none)
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Variant Test', '9845400004', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.item(null))) $$,
  'OPTION_NOT_AVAILABLE: %', 'an item without a variant is refused for a product that has variants');
select is((select count(*)::int from orders where customer_phone in ('9845400003', '9845400004')), 0, 'no order or partial order exists for the refused carts');

-- 5. the live cart check (#75) reports the same thing the menu card now shows
select is((select item_status from check_cart_items(jsonb_build_array(pg_temp.item((select large_id from vars))))), 'OPTION_NOT_AVAILABLE', 'check_cart_items reports an unavailable variant (used before an item is added)');

-- 6. archived variant
reset role;
update product_variants set is_available = true, archived_at = now() where id = (select large_id from vars);
set local role service_role;
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Variant Test', '9845400005', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.item((select large_id from vars)))) $$,
  'OPTION_NOT_AVAILABLE: %', 'an archived variant is refused');
select is((select item_status from check_cart_items(jsonb_build_array(pg_temp.item((select large_id from vars))))), 'OPTION_NOT_AVAILABLE', 'check_cart_items reports an archived variant');

-- 7. variant available again: ordering works (availability is read live, nothing is cached)
reset role;
update product_variants set archived_at = null where id = (select large_id from vars);
set local role service_role;
select lives_ok(
  $$ select place_order((select loc from ctx), null, 'Variant Test', '9845400006', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.item((select large_id from vars)))) $$,
  'once the variant is available again it can be ordered');
select is((select item_status from check_cart_items(jsonb_build_array(pg_temp.item((select large_id from vars))))), 'OK', 'check_cart_items reports the variant as OK again');

-- 8. product itself unavailable (product-level behaviour is unchanged)
reset role;
update products set is_available = false where id = (select simple_id from ctx);
set local role service_role;
select throws_like(
  $$ select place_order((select loc from ctx), null, 'Variant Test', '9845400007', null, (select pickup from ctx), null, jsonb_build_array(pg_temp.item((select large_id from vars)))) $$,
  'PRODUCT_UNAVAILABLE: %', 'a product that is switched off is refused even though its variant is available');
reset role;

-- 9. browser roles cannot order
set local role anon;
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'X Y', '9845400008', null, (select pickup from ctx), null, '[]') $$,
  '42501', null, 'place_order is not callable from the browser role');
reset role;

select * from finish();
rollback;
