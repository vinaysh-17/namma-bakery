-- Run with: supabase test db
-- Tests for migration 0029: security hardening
begin;
select plan(26);

-- ============================================================================
-- Fixtures
-- ============================================================================
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000e17', 'employee-017@test'),
  ('00000000-0000-0000-0000-000000000c17', 'cust-017@test')
on conflict (id) do nothing;

insert into staff_roles (user_id, role) values
  ('00000000-0000-0000-0000-000000000e17', 'EMPLOYEE')
on conflict (user_id) do nothing;

-- Insert a test notification as service_role for update tests
set local role service_role;
insert into portal_notifications (id, type, title, message, link_url, is_read)
values (
  '00000000-0000-0000-0000-00000000aa17',
  'NEW_ORDER',
  'Test Order',
  'Test message for 017',
  '/staff?tab=ORDERS',
  false
);
reset role;

-- ============================================================================
-- 1-6: anon SELECT revoked on non-public tables
-- ============================================================================
set local role anon;

select throws_ok(
  $$ select count(*) from orders $$,
  '42501',
  'permission denied for table orders',
  'anon cannot SELECT from orders'
);

select throws_ok(
  $$ select count(*) from portal_notifications $$,
  '42501',
  'permission denied for table portal_notifications',
  'anon cannot SELECT from portal_notifications'
);

select throws_ok(
  $$ select count(*) from staff_roles $$,
  '42501',
  'permission denied for table staff_roles',
  'anon cannot SELECT from staff_roles'
);

select throws_ok(
  $$ select count(*) from store_settings $$,
  '42501',
  'permission denied for table store_settings',
  'anon cannot SELECT from store_settings'
);

select throws_ok(
  $$ select count(*) from audit_logs $$,
  '42501',
  'permission denied for table audit_logs',
  'anon cannot SELECT from audit_logs'
);

select throws_ok(
  $$ select count(*) from profiles $$,
  '42501',
  'permission denied for table profiles',
  'anon cannot SELECT from profiles'
);

-- ============================================================================
-- 7-10: anon SELECT retained on public tables
-- ============================================================================
select lives_ok(
  $$ select count(*) from products $$,
  'anon can SELECT from products'
);

select lives_ok(
  $$ select count(*) from categories $$,
  'anon can SELECT from categories'
);

select lives_ok(
  $$ select count(*) from locations $$,
  'anon can SELECT from locations'
);

select lives_ok(
  $$ select count(*) from public_store_status $$,
  'anon can SELECT from public_store_status view'
);

reset role;

-- ============================================================================
-- 11-13: trigger functions not directly executable
-- ============================================================================
-- anon gets 0A000 (trigger functions can only be called as triggers) because
-- the function is SECURITY DEFINER and anon has no EXECUTE; PG may raise either
-- 42501 or 0A000 depending on the check order. We use throws_ok without errmsg.
select throws_ok(
  $$ select on_order_created_notification() $$,
  '0A000',
  'trigger functions can only be called as triggers',
  'anon cannot execute on_order_created_notification directly'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000e17', true);

select throws_ok(
  $$ select on_order_created_notification() $$,
  '42501',
  'permission denied for function on_order_created_notification',
  'authenticated cannot execute on_order_created_notification'
);

select throws_ok(
  $$ select on_custom_cake_created_notification() $$,
  '42501',
  'permission denied for function on_custom_cake_created_notification',
  'authenticated cannot execute on_custom_cake_created_notification'
);

reset role;

-- ============================================================================
-- 14: triggers still create notifications
-- ============================================================================
set local role service_role;

create temp table test017_before_count as
select count(*) as cnt from portal_notifications where type = 'NEW_ORDER';

create temp table ctx017 as
select (select id from locations limit 1) as loc,
       ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 12 hours') at time zone 'Asia/Kolkata') as pickup;

select place_order(
  (select loc from ctx017),
  '00000000-0000-0000-0000-000000000c17',
  'Test017 Customer',
  '9845017001',
  null,
  (select pickup from ctx017),
  null,
  (select jsonb_build_array(
    jsonb_build_object('product_id', id, 'weight_grams', 1000, 'egg_type', 'EGGLESS', 'quantity', 1)
  ) from products where slug = 'black-forest')
);

select ok(
  (select count(*) from portal_notifications where type = 'NEW_ORDER') >
  (select cnt from test017_before_count),
  'trigger still creates notification after EXECUTE revoked'
);

reset role;

-- ============================================================================
-- 15: employee can update is_read/read_at
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000e17', true);

select lives_ok(
  $$ update portal_notifications set is_read = true, read_at = now()
     where id = '00000000-0000-0000-0000-00000000aa17' $$,
  'employee can update is_read and read_at'
);

-- ============================================================================
-- 16: employee cannot INSERT into portal_notifications
-- ============================================================================
select throws_ok(
  $$ insert into portal_notifications (type, title, message, link_url)
     values ('NEW_ORDER', 'Fake', 'Fake message', '/staff') $$,
  '42501',
  'permission denied for table portal_notifications',
  'employee cannot INSERT into portal_notifications'
);

-- ============================================================================
-- 17-18: employee cannot update protected columns
-- ============================================================================
select throws_ok(
  $$ update portal_notifications set link_url = '/admin'
     where id = '00000000-0000-0000-0000-00000000aa17' $$,
  '42501',
  'permission denied for table portal_notifications',
  'employee cannot update link_url'
);

select throws_ok(
  $$ update portal_notifications set title = 'Tampered'
     where id = '00000000-0000-0000-0000-00000000aa17' $$,
  '42501',
  'permission denied for table portal_notifications',
  'employee cannot update title'
);

reset role;

-- ============================================================================
-- 19: non-staff user cannot update portal_notifications
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000c17', true);

select is(
  (select count(*) from portal_notifications
   where id = '00000000-0000-0000-0000-00000000aa17' and is_read = true),
  0::bigint,
  'non-staff sees 0 matching rows (RLS blocks UPDATE via empty result set)'
);

reset role;

-- ============================================================================
-- 20-25: CHECK constraint violations (as service_role to bypass RLS)
-- ============================================================================
set local role service_role;

select throws_ok(
  $$ insert into portal_notifications (type, title, message, link_url)
     values ('NEW_ORDER', 'Test', 'msg', 'https://evil.example') $$,
  '23514',
  NULL,
  'CHECK rejects https:// link_url'
);

select throws_ok(
  $$ insert into portal_notifications (type, title, message, link_url)
     values ('NEW_ORDER', 'Test', 'msg', '//evil.com/steal') $$,
  '23514',
  NULL,
  'CHECK rejects protocol-relative link_url'
);

select throws_ok(
  $$ insert into portal_notifications (type, title, message, link_url)
     values ('NEW_ORDER', 'Test', 'msg', 'javascript:alert(1)') $$,
  '23514',
  NULL,
  'CHECK rejects javascript: link_url'
);

select throws_ok(
  $$ insert into portal_notifications (type, title, message, link_url)
     values ('NEW_ORDER', 'Test', 'msg', '/staff?' || repeat('x', 300)) $$,
  '23514',
  NULL,
  'CHECK rejects link_url over 300 chars'
);

select throws_ok(
  $$ insert into portal_notifications (type, title, message, link_url)
     values ('NEW_ORDER', repeat('x', 201), 'msg', '/staff') $$,
  '23514',
  NULL,
  'CHECK rejects title over 200 chars'
);

select throws_ok(
  $$ insert into portal_notifications (type, title, message, link_url)
     values ('NEW_ORDER', 'Test', repeat('x', 1001), '/staff') $$,
  '23514',
  NULL,
  'CHECK rejects message over 1000 chars'
);

-- ============================================================================
-- 26: service_role can still insert valid notifications
-- ============================================================================
select lives_ok(
  $$ insert into portal_notifications (type, title, message, link_url)
     values ('NEW_ORDER', 'Valid Title', 'Valid message', '/staff?tab=ORDERS') $$,
  'service_role can insert valid notification'
);

reset role;

select * from finish();
rollback;
