-- Migration: 0027_prevent_self_role_demotion_and_concurrency.sql
--
-- Security hardening for Batch 3 (Staff Identity & Roles):
-- 1. Enforces that Admins cannot promote, demote, deactivate, or modify their own role/status.
-- 2. Eliminates deadlock risk and serializes concurrent role modifications using pg_advisory_xact_lock.
-- 3. Hardens protect_last_admin() trigger to enforce role invariants, self-modification prevention,
--    and last-active-admin protection against direct table mutations (closing PostgREST bypasses).

-- ----------------------------------------------------------------
-- 1. Replace public.update_staff_role with self-check & advisory lock
-- ----------------------------------------------------------------
create or replace function public.update_staff_role(
  p_user_id uuid, p_role app_role, p_is_active boolean
) returns staff_roles
language plpgsql security definer set search_path = public as $$
declare
  target staff_roles;
  v_active_admin_count int;
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Requirement: An Admin cannot promote, demote, deactivate, or modify their own account.
  -- This is enforced at the database level regardless of how many other admins exist.
  if auth.uid() is not null and p_user_id = auth.uid() then
    raise exception 'CANNOT_MODIFY_OWN_ROLE' using errcode = '42501';
  end if;

  -- Acquire transaction-level advisory lock to serialize role modifications.
  -- This prevents concurrent demotions from racing to leave zero admins, and
  -- eliminates row-lock inversion deadlocks.
  perform pg_advisory_xact_lock(hashtext('staff_roles_lock'));

  select * into target from staff_roles where user_id = p_user_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Protect the last active administrator
  if target.role = 'ADMIN' and target.is_active and (p_role <> 'ADMIN' or not p_is_active) then
    select count(*) into v_active_admin_count from staff_roles where role = 'ADMIN' and is_active;

    if v_active_admin_count <= 1 then
      raise exception 'LAST_ADMIN_PROTECTED' using errcode = 'P0001';
    end if;
  end if;

  update staff_roles
  set role = p_role, is_active = p_is_active
  where user_id = p_user_id
  returning * into target;

  return target;
end $$;

revoke all on function public.update_staff_role(uuid, app_role, boolean) from public, anon;
grant execute on function public.update_staff_role(uuid, app_role, boolean) to authenticated, service_role;

-- ----------------------------------------------------------------
-- 2. Clean up temporary trigger if previously created and update protect_last_admin()
-- ----------------------------------------------------------------
drop trigger if exists trg_enforce_staff_role_invariants on staff_roles;
drop function if exists public.enforce_staff_role_invariants();

create or replace function public.protect_last_admin()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Serialize with the same transaction lock as update_staff_role
  perform pg_advisory_xact_lock(hashtext('staff_roles_lock'));

  -- Last active admin protection: check first so removing/demoting the sole admin is always blocked
  if (tg_op = 'DELETE' or new.role <> 'ADMIN' or not new.is_active) and old.role = 'ADMIN' and old.is_active then
    if (select count(*) from staff_roles where role = 'ADMIN' and is_active and user_id <> old.user_id) = 0 then
      raise exception 'cannot remove the last active admin' using errcode = 'P0001';
    end if;
  end if;

  -- Self-role modification protection against direct table mutations:
  -- If invoked by an authenticated user on their own account, reject role or active status changes
  if auth.uid() is not null and auth.uid() = old.user_id then
    if (tg_op = 'DELETE') or (new.role is distinct from old.role) or (new.is_active is distinct from old.is_active) then
      raise exception 'CANNOT_MODIFY_OWN_ROLE' using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end $$;

-- Ensure trigger is present on staff_roles
drop trigger if exists trg_protect_last_admin on staff_roles;
create trigger trg_protect_last_admin
  before update or delete on staff_roles
  for each row execute function public.protect_last_admin();

notify pgrst, 'reload schema';
