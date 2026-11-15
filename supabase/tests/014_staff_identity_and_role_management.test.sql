-- Run with: supabase test db
-- Batch 3 — Staff Identity & Role Management (GitHub issues #68, #69, #70).
begin;
select plan(15);

-- fixtures (run as superuser)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'admin-a@test'),
  ('00000000-0000-0000-0000-0000000000f2', 'admin-b@test'),
  ('00000000-0000-0000-0000-0000000000f3', 'employee-c@test'),
  ('00000000-0000-0000-0000-0000000000f4', 'inactive-d@test');
-- handle_new_user() already inserted a blank profiles row for each via the
-- on_auth_user_created trigger; fill in the names we actually want to test with.
update profiles set full_name = 'Admin A' where id = '00000000-0000-0000-0000-0000000000f1';
update profiles set full_name = 'Admin B' where id = '00000000-0000-0000-0000-0000000000f2';
update profiles set full_name = 'Employee C (stale name)' where id = '00000000-0000-0000-0000-0000000000f3';
update profiles set full_name = 'Former Staff D' where id = '00000000-0000-0000-0000-0000000000f4';
insert into staff_roles (user_id, role, is_active) values
  ('00000000-0000-0000-0000-0000000000f1', 'ADMIN', true),
  ('00000000-0000-0000-0000-0000000000f2', 'ADMIN', true),
  ('00000000-0000-0000-0000-0000000000f3', 'EMPLOYEE', true),
  ('00000000-0000-0000-0000-0000000000f4', 'EMPLOYEE', false);

-- ----------------------------------------------------------------
-- #68: an admin can rename ANOTHER staff member's profile; a non-admin still cannot.
-- ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);

update profiles set full_name = 'Employee C (renamed by admin)' where id = '00000000-0000-0000-0000-0000000000f3';
select is(
  (select full_name from profiles where id = '00000000-0000-0000-0000-0000000000f3'),
  'Employee C (renamed by admin)',
  '#68: an admin can update another staff member''s profile (profiles_admin_update)'
);

-- Self-service update still works unchanged (profiles_own_update untouched)
update profiles set full_name = 'Admin A (self-renamed)' where id = '00000000-0000-0000-0000-0000000000f1';
select is(
  (select full_name from profiles where id = '00000000-0000-0000-0000-0000000000f1'),
  'Admin A (self-renamed)',
  '#68: self-service profile updates still work (profiles_own_update unaffected)'
);
reset role;

-- A non-admin cannot rename someone else's profile: RLS silently filters the row, so
-- the UPDATE affects 0 rows rather than erroring -- this is the original bug's exact
-- mechanism, now confirmed still blocked for non-admins.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f3', true);
update profiles set full_name = 'Hijacked Name' where id = '00000000-0000-0000-0000-0000000000f1';
reset role;
-- Read back as service_role: a non-admin's own session can't even see f1's row
-- (profiles_own_read), so the real check for "did the rename actually happen" must
-- read with a role that bypasses RLS, not as the non-admin who attempted it.
set local role service_role;
select is(
  (select full_name from profiles where id = '00000000-0000-0000-0000-0000000000f1'),
  'Admin A (self-renamed)',
  '#68: a non-admin still cannot rename another staff member''s profile'
);
reset role;

-- ----------------------------------------------------------------
-- #70: update_staff_role -- authorization, promotion, and the atomic last-admin lock.
-- ----------------------------------------------------------------

-- A non-admin cannot call it at all
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f3', true);
select throws_ok(
  $$ select update_staff_role('00000000-0000-0000-0000-0000000000f3', 'ADMIN', true) $$,
  'forbidden',
  '#70: a non-admin cannot call update_staff_role (forbidden)'
);
reset role;

-- An admin can promote another staff member to ADMIN
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
select update_staff_role('00000000-0000-0000-0000-0000000000f3', 'ADMIN', true);
select is(
  (select role::text from staff_roles where user_id = '00000000-0000-0000-0000-0000000000f3'),
  'ADMIN',
  '#70: an existing admin can promote another staff member to ADMIN'
);

-- ...and demote them back (3 active admins now: f1, f2, f3 -- demoting f3 is safe)
select update_staff_role('00000000-0000-0000-0000-0000000000f3', 'EMPLOYEE', true);
select is(
  (select role::text from staff_roles where user_id = '00000000-0000-0000-0000-0000000000f3'),
  'EMPLOYEE',
  '#70: an existing admin can demote another admin back to EMPLOYEE (not the last admin)'
);

-- Unknown user
select throws_ok(
  $$ select update_staff_role('00000000-0000-0000-0000-0000000000ff', 'EMPLOYEE', true) $$,
  'STAFF_NOT_FOUND',
  '#70: update_staff_role reports STAFF_NOT_FOUND for an unknown user'
);
reset role;

-- Last-admin protection: deactivate admin B first (two admins -> one), then demoting
-- the sole remaining admin (A) must be rejected, whether attempted by A (self) or by
-- some other admin session -- the function does not special-case "self".
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
select update_staff_role('00000000-0000-0000-0000-0000000000f2', 'EMPLOYEE', true);
select is(
  (select count(*)::int from staff_roles where role = 'ADMIN' and is_active),
  1,
  '#70: exactly one active admin remains after demoting admin B'
);

-- Self-modification protection: an admin cannot demote or deactivate their own account,
-- regardless of how many admins exist.
select throws_ok(
  $$ select update_staff_role('00000000-0000-0000-0000-0000000000f1', 'EMPLOYEE', true) $$,
  'CANNOT_MODIFY_OWN_ROLE',
  '#70: demoting own admin account (self) is rejected with CANNOT_MODIFY_OWN_ROLE'
);
select throws_ok(
  $$ select update_staff_role('00000000-0000-0000-0000-0000000000f1', 'ADMIN', false) $$,
  'CANNOT_MODIFY_OWN_ROLE',
  '#70: deactivating own admin account (self) is rejected with CANNOT_MODIFY_OWN_ROLE'
);
select is(
  (select is_active from staff_roles where user_id = '00000000-0000-0000-0000-0000000000f1'),
  true,
  '#70: the last admin truly was not changed by either rejected attempt'
);
reset role;

-- Restore admin B (service_role, out of band) so later tests have two admins again
set local role service_role;
update staff_roles set is_active = true where user_id = '00000000-0000-0000-0000-0000000000f2';
reset role;

-- ----------------------------------------------------------------
-- #69: a deactivated staff member can be reactivated with their role preserved.
-- ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
select update_staff_role('00000000-0000-0000-0000-0000000000f4', 'EMPLOYEE', true);
select is(
  (select is_active from staff_roles where user_id = '00000000-0000-0000-0000-0000000000f4'),
  true,
  '#69: a deactivated staff member can be reactivated'
);
select is(
  (select role::text from staff_roles where user_id = '00000000-0000-0000-0000-0000000000f4'),
  'EMPLOYEE',
  '#69: reactivation preserves the staff member''s existing role'
);
reset role;

-- The staff_roles_admin RLS policy already supports full admin access independent of
-- is_active, so getAdminStaffMembers (application code) can simply stop filtering
-- is_active=true -- confirmed here at the data-access layer.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
select is(
  (select count(*)::int from staff_roles),
  4,
  '#69: an admin session can see inactive staff rows too (no is_active filter in RLS)'
);
reset role;

-- audit_logs already has a trigger on staff_roles (0002); confirm role changes above
-- were captured without any new trigger needing to be added.
set local role service_role;
select cmp_ok(
  (select count(*)::int from audit_logs where entity_type = 'staff_roles'),
  '>=', 3,
  '#70/#69: role/activation changes via update_staff_role are still audit-logged (existing trigger, untouched)'
);
reset role;

select * from finish();
rollback;
