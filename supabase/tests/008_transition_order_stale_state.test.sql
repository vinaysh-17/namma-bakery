-- Run with: supabase test db
-- Stale-state protection for order transitions (GitHub issue #79) - requires migration 0022.
begin;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e3', 'employee@test'),
  ('00000000-0000-0000-0000-0000000000d4', 'admin@test');
insert into staff_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000e3', 'EMPLOYEE'),
  ('00000000-0000-0000-0000-0000000000d4', 'ADMIN');

create temp table ctx as
select (select id from locations limit 1) as loc,
       ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 12 hours') at time zone 'Asia/Kolkata') as pickup;
grant select on ctx to anon, authenticated, service_role;

create temp table ord (label text primary key, id uuid);
grant all on ord to anon, authenticated, service_role;

create function pg_temp.place(p_label text, p_phone text) returns void language sql as $$
  insert into ord select p_label, order_id from place_order((select loc from ctx), null, 'Test Customer', p_phone, null, (select pickup from ctx), null,
    (select jsonb_build_array(jsonb_build_object('product_id', id, 'weight_grams', 1000, 'egg_type', 'EGGLESS', 'quantity', 1)) from products where slug = 'black-forest'))
$$;
grant execute on function pg_temp.place(text, text) to service_role;

set local role service_role;
select pg_temp.place('stale', '9845200001');      -- walked through the workflow below
select pg_temp.place('done', '9845200002');       -- completed + paid
select pg_temp.place('paid', '9845200003');       -- ready for pickup + paid
select pg_temp.place('override', '9845200004');   -- stays pending for the legitimate override
select pg_temp.place('legacy', '9845200005');     -- legacy (no expected status) call
reset role;

-- ================================================================ employee
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e3', true);

-- 1. correct expected status allows a valid transition
select is((select status::text from transition_order((select id from ord where label = 'stale'), 'ACCEPTED', null, (select pickup from ctx), 'PENDING')),
  'ACCEPTED', 'correct expected status allows the transition');

-- 2. the same screen acting again (now stale) is refused and changes nothing
select throws_ok(
  $$ select transition_order((select id from ord where label = 'stale'), 'ACCEPTED', null, (select pickup from ctx), 'PENDING') $$,
  'STALE_STATE: expected PENDING, actual ACCEPTED', 'a stale expected status is rejected');
select is((select status::text from orders where id = (select id from ord where label = 'stale')), 'ACCEPTED', 'a rejected stale action leaves the order unchanged');
select is((select count(*)::int from order_status_history where order_id = (select id from ord where label = 'stale')), 2, 'a rejected stale action writes no history');

-- 3. legacy call without an expected status still works for normal transitions
select is((select status::text from transition_order((select id from ord where label = 'legacy'), 'ACCEPTED', null, (select pickup from ctx))),
  'ACCEPTED', 'existing 4-argument calls keep working for normal transitions');

-- 4. employees still cannot override or use admin-only moves, with or without an expected status
select throws_ok(
  $$ select transition_order((select id from ord where label = 'stale'), 'READY_FOR_PICKUP', 'skip ahead', null, 'ACCEPTED') $$,
  'INVALID_TRANSITION: ACCEPTED -> READY_FOR_PICKUP', 'an employee cannot override the workflow');

-- walk the other orders to READY_FOR_PICKUP through the normal workflow
select transition_order((select id from ord where label = 'done'), 'ACCEPTED', null, (select pickup from ctx), 'PENDING');
select transition_order((select id from ord where label = 'done'), 'PREPARING', null, null, 'ACCEPTED');
select transition_order((select id from ord where label = 'done'), 'READY_FOR_PICKUP', null, null, 'PREPARING');
select transition_order((select id from ord where label = 'paid'), 'ACCEPTED', null, (select pickup from ctx), 'PENDING');
select transition_order((select id from ord where label = 'paid'), 'PREPARING', null, null, 'ACCEPTED');
select transition_order((select id from ord where label = 'paid'), 'READY_FOR_PICKUP', null, null, 'PREPARING');
select throws_ok(
  $$ select transition_order((select id from ord where label = 'paid'), 'CANCELLED', 'nope', null, 'READY_FOR_PICKUP') $$,
  'INVALID_TRANSITION: READY_FOR_PICKUP -> CANCELLED', 'an employee cannot cancel a ready order');

-- take payment and complete 'done'; take payment on 'paid' but leave it ready for pickup
select record_store_payment((select id from ord where label = 'done'), 70000);
select record_store_payment((select id from ord where label = 'paid'), 70000);
select is((select status::text from transition_order((select id from ord where label = 'done'), 'COMPLETED', 'handed over', null, 'READY_FOR_PICKUP')),
  'COMPLETED', 'a legitimate completion with the matching expected status works');
select throws_ok(
  $$ select transition_order((select id from ord where label = 'done'), 'COMPLETED', 'again', null, 'READY_FOR_PICKUP') $$,
  'STALE_STATE: expected READY_FOR_PICKUP, actual COMPLETED', 'repeating the completion from the old screen is rejected, not applied twice');

-- admin_only transition (PREPARING -> CANCELLED) is still admin-only even with a correct expected status
reset role;
select pg_temp.place('prep', '9845200006');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e3', true);
select transition_order((select id from ord where label = 'prep'), 'ACCEPTED', null, (select pickup from ctx), 'PENDING');
select transition_order((select id from ord where label = 'prep'), 'PREPARING', null, null, 'ACCEPTED');
select throws_ok(
  $$ select transition_order((select id from ord where label = 'prep'), 'CANCELLED', 'no', null, 'PREPARING') $$,
  '42501', null, 'admin-only transitions stay admin-only for employees');
reset role;

-- ================================================================ admin
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', true);

-- 5. the issue: admin cancels an order their screen shows as ACCEPTED, but it is COMPLETED (and paid)
select throws_ok(
  $$ select transition_order((select id from ord where label = 'done'), 'CANCELLED', 'customer changed mind', null, 'ACCEPTED') $$,
  'STALE_STATE: expected ACCEPTED, actual COMPLETED', 'a stale admin action cannot trigger an override');
select is((select status::text from orders where id = (select id from ord where label = 'done')), 'COMPLETED', 'the completed order is still COMPLETED');
select is((select payment_status::text from orders where id = (select id from ord where label = 'done')), 'paid', 'and still paid (no paid + cancelled state)');

-- 6. even with a matching expected status, a completed order is final
select throws_ok(
  $$ select transition_order((select id from ord where label = 'done'), 'CANCELLED', 'customer changed mind', null, 'COMPLETED') $$,
  'ORDER_FINAL', 'a completed order cannot be cancelled by an admin override');

-- 7. a paid order cannot be cancelled by an override
select throws_ok(
  $$ select transition_order((select id from ord where label = 'paid'), 'CANCELLED', 'customer changed mind', null, 'READY_FOR_PICKUP') $$,
  'PAID_ORDER_CANNOT_BE_CANCELLED', 'a paid order cannot be cancelled by an admin override');

-- 8. an override can never run without stating the status the screen showed
select throws_ok(
  $$ select transition_order((select id from ord where label = 'override'), 'READY_FOR_PICKUP', 'kitchen finished early') $$,
  'EXPECTED_STATUS_REQUIRED', 'an admin override without an expected status is refused');

-- 9. a legitimate admin override (reason + matching expected status, unpaid, not final) still works and is audited
select is((select status::text from transition_order((select id from ord where label = 'override'), 'READY_FOR_PICKUP', 'kitchen finished early', null, 'PENDING')),
  'READY_FOR_PICKUP', 'a legitimate admin override still works');
select is((select (after_data->>'override')::boolean from audit_logs where entity_id = (select id::text from ord where label = 'override') order by id desc limit 1),
  true, 'the override is recorded in the audit log');
reset role;

-- ================================================================ outsiders
set local role anon;
select throws_ok(
  $$ select transition_order('00000000-0000-0000-0000-000000000000'::uuid, 'ACCEPTED'::order_status, null, null, 'PENDING'::order_status) $$,
  '42501', null, 'anonymous callers still cannot call transition_order');
reset role;

select * from finish();
rollback;
