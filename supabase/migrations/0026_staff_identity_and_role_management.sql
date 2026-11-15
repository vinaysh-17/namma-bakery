-- Migration: 0026_staff_identity_and_role_management.sql
--
-- Batch 3 — Staff Identity & Role Management (GitHub issues #68, #69, #70).
--
-- #68: Renaming another staff member doesn't stick. updateStaffMemberAction already
-- tries to sync profiles.full_name/phone for the target user via the admin's own
-- session, but the only UPDATE policy on profiles is "id = auth.uid()" (0003), so the
-- update silently affects 0 rows for anyone but yourself. getAdminStaffMembers then
-- prefers the (now stale) profiles.full_name over the freshly-updated auth metadata,
-- so the staff list keeps showing the old name.
--
-- Fix: one narrowly-scoped additional UPDATE policy, admin-only. profiles has no role
-- or other privileged column at all (full_name, phone, created_at, updated_at), so this
-- can never be used to change a user's authorization -- that still lives entirely in
-- staff_roles, gated by is_admin(). Postgres combines multiple permissive policies for
-- the same command with OR, so this is purely additive: the existing self-service
-- policy (profiles_own_update) is untouched and keeps working exactly as before.
create policy profiles_admin_update on profiles for update to authenticated
  using (is_admin()) with check (is_admin());

-- #70: both updateStaffRoleAction and removeStaffMemberAction protect the last active
-- admin with an application-level "SELECT count(*), then UPDATE" -- a classic
-- check-then-act race. Two concurrent demotions/removals could each read the count
-- before either write commits, and both pass, leaving zero active admins. This
-- function makes that check atomic: it locks the target row, and -- only when the
-- change would actually remove an active admin -- locks every active-admin row before
-- re-counting, so a second concurrent call attempting the same thing blocks on the
-- same locks and sees the first call's result once it proceeds.
--
-- This also becomes the single place that performs a staff_roles role/is_active
-- change, so updateStaffRoleAction and removeStaffMemberAction share one
-- race-free implementation instead of two independent racy ones.
create or replace function public.update_staff_role(
  p_user_id uuid, p_role app_role, p_is_active boolean
) returns staff_roles
language plpgsql security definer set search_path = public as $$
declare
  target staff_roles;
  v_active_admin_count int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into target from staff_roles where user_id = p_user_id for update;
  if not found then raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001'; end if;

  -- Only when this change would make the target NOT an active admin (demotion,
  -- deactivation, or both) do we need the expensive, lock-everything count.
  if target.role = 'ADMIN' and target.is_active and (p_role <> 'ADMIN' or not p_is_active) then
    -- Lock every currently active admin row (including the target's, already locked
    -- above) before counting, so a concurrent call touching a DIFFERENT admin blocks
    -- here until this transaction commits or rolls back, instead of reading a stale
    -- count that both calls could pass.
    perform 1 from staff_roles where role = 'ADMIN' and is_active for update;

    select count(*) into v_active_admin_count from staff_roles where role = 'ADMIN' and is_active;

    if v_active_admin_count <= 1 then
      raise exception 'LAST_ADMIN_PROTECTED' using errcode = 'P0001';
    end if;
  end if;

  update staff_roles set role = p_role, is_active = p_is_active
  where user_id = p_user_id
  returning * into target;

  return target;
end $$;

revoke all on function public.update_staff_role(uuid, app_role, boolean) from public, anon;
grant execute on function public.update_staff_role(uuid, app_role, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
