-- Run with: supabase test db
-- Tests for Migration 0027: Self-role modification prevention, direct table invariants & last-admin protection.
begin;
select plan(14);

-- Fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'admin-1@test'),
  ('00000000-0000-0000-0000-0000000000e2', 'admin-2@test'),
  ('00000000-0000-0000-0000-0000000000e3', 'staff-3@test'),
  ('00000000-0000-0000-0000-0000000000e4', 'inactive-4@test');

update profiles set full_name = 'Admin 1' where id = '00000000-0000-0000-0000-0000000000e1';
update profiles set full_name = 'Admin 2' where id = '00000000-0000-0000-0000-0000000000e2';
update profiles set full_name = 'Staff 3' where id = '00000000-0000-0000-0000-0000000000e3';
update profiles set full_name = 'Inactive 4' where id = '00000000-0000-0000-0000-0000000000e4';

insert into staff_roles (user_id, role, is_active) values
  ('00000000-0000-0000-0000-0000000000e1', 'ADMIN', true),
  ('00000000-0000-0000-0000-0000000000e2', 'ADMIN', true),
  ('00000000-0000-0000-0000-0000000000e3', 'EMPLOYEE', true),
  ('00000000-0000-0000-0000-0000000000e4', 'EMPLOYEE', false);

-- ----------------------------------------------------------------
-- 1. update_staff_role RPC: Self-role modification rejection
-- ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);

-- Attempt self-demotion when another admin exists (e1 and e2 are both active admins)
select throws_ok(
  $$ select update_staff_role('00000000-0000-0000-0000-0000000000e1', 'EMPLOYEE', true) $$,
  'CANNOT_MODIFY_OWN_ROLE',
  'RPC: Admin cannot demote themselves even when multiple active Admins exist'
);

-- Attempt self-deactivation when another admin exists
select throws_ok(
  $$ select update_staff_role('00000000-0000-0000-0000-0000000000e1', 'ADMIN', false) $$,
  'CANNOT_MODIFY_OWN_ROLE',
  'RPC: Admin cannot deactivate themselves even when multiple active Admins exist'
);

-- ----------------------------------------------------------------
-- 2. Direct Table UPDATE Mutations (Testing trigger enforcement)
-- ----------------------------------------------------------------

-- Direct UPDATE attempting self-demotion
select throws_ok(
  $$ update staff_roles set role = 'EMPLOYEE' where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'CANNOT_MODIFY_OWN_ROLE',
  'Direct UPDATE: cannot demote self via direct table mutation'
);

-- Direct UPDATE attempting self-deactivation
select throws_ok(
  $$ update staff_roles set is_active = false where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'CANNOT_MODIFY_OWN_ROLE',
  'Direct UPDATE: cannot deactivate self via direct table mutation'
);

-- Direct DELETE attempting self-removal
select throws_ok(
  $$ delete from staff_roles where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'CANNOT_MODIFY_OWN_ROLE',
  'Direct DELETE: cannot delete self via direct table mutation'
);

-- ----------------------------------------------------------------
-- 3. Legitimate Admin Actions on Other Staff
-- ----------------------------------------------------------------

-- Admin 1 promotes Staff 3 to Admin
select lives_ok(
  $$ select update_staff_role('00000000-0000-0000-0000-0000000000e3', 'ADMIN', true) $$,
  'RPC: Admin 1 can legitimately promote Staff 3 to Admin'
);
select is(
  (select role::text from staff_roles where user_id = '00000000-0000-0000-0000-0000000000e3'),
  'ADMIN',
  'Staff 3 role is now ADMIN'
);

-- Admin 1 demotes Admin 2 to Employee (e1 and e3 are active admins, so e2 can be demoted)
select lives_ok(
  $$ select update_staff_role('00000000-0000-0000-0000-0000000000e2', 'EMPLOYEE', true) $$,
  'RPC: Admin 1 can legitimately demote Admin 2 to Employee'
);

-- Admin 1 reactivates Inactive 4
select lives_ok(
  $$ select update_staff_role('00000000-0000-0000-0000-0000000000e4', 'EMPLOYEE', true) $$,
  'RPC: Admin 1 can reactivate Inactive 4'
);
select is(
  (select is_active from staff_roles where user_id = '00000000-0000-0000-0000-0000000000e4'),
  true,
  'Inactive 4 is now active'
);

-- Demote Staff 3 back to Employee (now Admin 1 is the ONLY active admin)
select update_staff_role('00000000-0000-0000-0000-0000000000e3', 'EMPLOYEE', true);
select is(
  (select count(*)::int from staff_roles where role = 'ADMIN' and is_active),
  1,
  'Exactly 1 active admin remains (Admin 1)'
);

-- ----------------------------------------------------------------
-- 4. Last Active Admin Protection via Trigger
-- ----------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Attempting direct UPDATE to demote the last active admin as superuser/service_role
select throws_ok(
  $$ update staff_roles set role = 'EMPLOYEE' where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'cannot remove the last active admin',
  'Trigger: direct UPDATE demoting the last active admin is blocked'
);

-- Attempting direct UPDATE to deactivate the last active admin as superuser/service_role
select throws_ok(
  $$ update staff_roles set is_active = false where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'cannot remove the last active admin',
  'Trigger: direct UPDATE deactivating the last active admin is blocked'
);

-- Attempting direct DELETE of the last active admin as superuser/service_role
select throws_ok(
  $$ delete from staff_roles where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'cannot remove the last active admin',
  'Trigger: direct DELETE of the last active admin is blocked'
);

select * from finish();
rollback;
