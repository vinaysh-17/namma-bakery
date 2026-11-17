-- Run with: supabase test db
-- Issue #78: get_order_by_token returns cancellation_reason and all expected fields.
begin;
select plan(9);

-- Fixtures: create a test order via place_order (service_role only)
create temp table ctx as
select (select id from locations limit 1) as loc,
       ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 12 hours') at time zone 'Asia/Kolkata') as pickup;
grant select on ctx to anon, authenticated, service_role;

set local role service_role;

create temp table test_order as
select * from place_order(
  (select loc from ctx), null, 'Tracking Tester', '9845018001', null,
  (select pickup from ctx), null,
  (select jsonb_build_array(jsonb_build_object(
    'product_id', id, 'weight_grams', 1000, 'egg_type', 'EGGLESS', 'quantity', 1
  )) from products where slug = 'black-forest')
);

-- 1. Non-cancelled order: cancellation_reason is null
select is(
  (select get_order_by_token((select public_token from test_order)) -> 'cancellation_reason'),
  'null'::jsonb,
  'Non-cancelled order returns null cancellation_reason');

-- 2. Non-cancelled order: rejection_reason is null
select is(
  (select get_order_by_token((select public_token from test_order)) -> 'rejection_reason'),
  'null'::jsonb,
  'Non-cancelled order returns null rejection_reason');

-- 3. Status field is returned
select is(
  (select get_order_by_token((select public_token from test_order)) ->> 'status'),
  'PENDING',
  'Tracking returns correct status for a new order');

-- 4. first_name is extracted correctly
select is(
  (select get_order_by_token((select public_token from test_order)) ->> 'first_name'),
  'Tracking',
  'first_name is first word of customer_name');

-- 5. Cancelled order: cancellation_reason is returned
update orders
  set status = 'CANCELLED', cancellation_reason = 'Customer changed their mind'
  where id = (select order_id from test_order);

select is(
  (select get_order_by_token((select public_token from test_order)) ->> 'cancellation_reason'),
  'Customer changed their mind',
  'Cancelled order returns cancellation_reason');

-- 6. Cancelled order: status reflects CANCELLED
select is(
  (select get_order_by_token((select public_token from test_order)) ->> 'status'),
  'CANCELLED',
  'Tracking returns CANCELLED status after cancellation');

reset role;

-- 7. Invalid token returns NULL
set local role service_role;
select is(
  (select get_order_by_token('non-existent-token-value-00000000000000000000000000000000000000')),
  null,
  'Invalid token returns NULL');
reset role;

-- 8. Anon role cannot execute get_order_by_token
set local role anon;
select throws_ok(
  $$ select get_order_by_token('any-token') $$,
  '42501', null,
  'Anonymous users cannot call get_order_by_token');
reset role;

-- 9. Authenticated role cannot execute get_order_by_token
set local role authenticated;
select throws_ok(
  $$ select get_order_by_token('any-token') $$,
  '42501', null,
  'Authenticated users cannot call get_order_by_token');
reset role;

select * from finish();
rollback;
