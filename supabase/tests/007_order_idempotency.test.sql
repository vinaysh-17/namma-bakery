-- Run with: supabase test db
-- Order placement idempotency (GitHub issue #98) - requires migration 0021.
begin;
select plan(18);

create temp table ctx as
select (select id from locations limit 1) as loc,
       ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 12 hours') at time zone 'Asia/Kolkata') as pickup,
       ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 13 hours') at time zone 'Asia/Kolkata') as pickup2;
grant select on ctx to anon, authenticated, service_role;

-- helper: place a Black Forest 1 kg eggless order (server-side), optionally with a key
create function pg_temp.items() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('product_id', id, 'weight_grams', 1000, 'egg_type', 'EGGLESS', 'quantity', 1))
    from products where slug = 'black-forest'
$$;
grant execute on function pg_temp.items() to service_role;

create temp table results (label text, order_id uuid, order_number text, public_token text, replayed boolean);
grant all on results to service_role;

set local role service_role;

-- 1. a normal order without any key still works (backward compatible 8-argument call)
insert into results select 'plain', * from place_order((select loc from ctx), null, 'Plain Customer', '9845100001', null, (select pickup from ctx), null, pg_temp.items());
select matches((select order_number from results where label = 'plain'), '^NB[0-9]+$', 'order without an idempotency key still succeeds');
select is((select replayed from results where label = 'plain'), false, 'order without a key is not reported as a replay');

-- 2. first request with a key creates the order
insert into results select 'first', * from place_order((select loc from ctx), null, 'Key Customer', '9845100002', null, (select pickup from ctx), null, pg_temp.items(), 'checkout-attempt-key-0001');
select is((select count(*)::int from orders where idempotency_key = 'checkout-attempt-key-0001'), 1, 'first request with key X creates exactly one order');
select is((select replayed from results where label = 'first'), false, 'first request is not a replay');

-- 3. replay with the same key does not create a second order and returns the same order
insert into results select 'replay', * from place_order((select loc from ctx), null, 'Key Customer', '9845100002', null, (select pickup from ctx), null, pg_temp.items(), 'checkout-attempt-key-0001');
select is((select count(*)::int from orders where idempotency_key = 'checkout-attempt-key-0001'), 1, 'replay with key X creates no second order');
select is((select count(*)::int from orders where customer_phone = '9845100002'), 1, 'still exactly one order for that customer');
select is((select order_number from results where label = 'replay'), (select order_number from results where label = 'first'), 'replay returns the same order number');
select is((select public_token from results where label = 'replay'), (select public_token from results where label = 'first'), 'replay returns the same tracking token');
select is((select replayed from results where label = 'replay'), true, 'replay is flagged as replayed');
select is((select count(*)::int from order_items where order_id = (select order_id from results where label = 'first')), 1, 'replay does not duplicate order items');
select is((select total_paise from orders where idempotency_key = 'checkout-attempt-key-0001'), 70000, 'order total is unchanged (price still comes from the database)');

-- 4. a different key is a separate, legitimate order
insert into results select 'other', * from place_order((select loc from ctx), null, 'Key Customer', '9845100003', null, (select pickup from ctx), null, pg_temp.items(), 'checkout-attempt-key-0002');
select isnt((select order_number from results where label = 'other'), (select order_number from results where label = 'first'), 'a different key creates a different order');

-- 5. a key cannot be replayed for another customer or another pickup time
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'Someone Else', '9845100099', null, (select pickup from ctx), null, pg_temp.items(), 'checkout-attempt-key-0001') $$,
  'IDEMPOTENCY_KEY_REUSED', 'the same key with a different phone is refused (cannot read another order)');
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'Key Customer', '9845100002', null, (select pickup2 from ctx), null, pg_temp.items(), 'checkout-attempt-key-0001') $$,
  'IDEMPOTENCY_KEY_REUSED', 'the same key with a different pickup time is refused');

-- 6. malformed keys are rejected
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'Key Customer', '9845100004', null, (select pickup from ctx), null, pg_temp.items(), 'short') $$,
  'INVALID_IDEMPOTENCY_KEY', 'a malformed key is rejected');

reset role;

-- 7. browser roles still cannot call place_order
set local role anon;
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'X Y', '9845100005', null, (select pickup from ctx), null, '[]', 'checkout-attempt-key-0003') $$,
  '42501', null, 'place_order (with key) is not callable from the browser role');
reset role;

-- 8. a replay still returns the order when the order itself now fills the open-order limit
update store_settings set max_open_orders_per_phone = 1 where location_id = (select loc from ctx);
set local role service_role;
insert into results select 'limit-first', * from place_order((select loc from ctx), null, 'Limit Customer', '9845100006', null, (select pickup from ctx), null, pg_temp.items(), 'checkout-attempt-key-0004');
select is(
  (select order_number from place_order((select loc from ctx), null, 'Limit Customer', '9845100006', null, (select pickup from ctx), null, pg_temp.items(), 'checkout-attempt-key-0004')),
  (select order_number from results where label = 'limit-first'),
  'replay returns the order even though the customer is now at the open-order limit');
select throws_ok(
  $$ select place_order((select loc from ctx), null, 'Limit Customer', '9845100006', null, (select pickup from ctx), null, pg_temp.items(), 'checkout-attempt-key-0005') $$,
  'TOO_MANY_OPEN_ORDERS', 'a genuinely new checkout attempt is still limited as before');
reset role;

select * from finish();
rollback;
