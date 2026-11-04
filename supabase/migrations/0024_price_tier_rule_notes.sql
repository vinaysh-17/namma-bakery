-- Migration: 0024_price_tier_rule_notes.sql
--
-- GitHub issue #72: "Internal admin notes on cake pricing are shown to customers".
--
-- price_tier_rules.note (an internal staff note) and price_tier_rules.verified (the owner has
-- confirmed the price) were columns on a table that customers read: 0003 grants SELECT on every
-- column of every public table to anon/authenticated, and rules_read lets them read every active
-- rule. So anyone with the public key could read both fields through the REST API, whatever the
-- storefront renders. Postgres cannot hide a column from only SOME authenticated users (admins and
-- signed-in customers share that role), so the fields move to their own table, protected by RLS.
--
-- This migration:
--   1. creates public.price_tier_rule_notes (rule_id -> note, verified), one row per rule,
--   2. allows ONLY admins (is_admin()) to read or write it; anon gets no privileges at all,
--   3. copies every existing note / verified value across,
--   4. drops price_tier_rules.note and price_tier_rules.verified,
--   5. audit-logs future changes to notes, as changes to the old columns were.
--
-- Customer pricing and ordering are unaffected: place_order / check_cart_items never read note or
-- verified. Re-runnable: the copy only runs while the old columns still exist.
--
-- DEPLOY TOGETHER with the app change that reads/writes price_tier_rule_notes (admin pricing).
-- Until both are live, saving an admin price rule with the old code fails (column gone) or
-- the new code cannot find the notes table.

-- 1. table -------------------------------------------------------------------------------------
create table if not exists public.price_tier_rule_notes (
  rule_id    uuid primary key references public.price_tier_rules(id) on delete cascade,
  note       text,
  verified   boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 2. access: admins only ------------------------------------------------------------------------
alter table public.price_tier_rule_notes enable row level security;

-- 0003 sets default privileges that grant SELECT on every new table to anon/authenticated.
-- Remove those, then grant only what the admin policy needs (authenticated + is_admin()).
revoke all on public.price_tier_rule_notes from public, anon, authenticated;
grant select, insert, update, delete on public.price_tier_rule_notes to authenticated;

drop policy if exists price_rule_notes_admin_all on public.price_tier_rule_notes;
create policy price_rule_notes_admin_all on public.price_tier_rule_notes
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- 3 + 4. copy the existing values, then drop the old columns -----------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'price_tier_rules' and column_name = 'note'
  ) then
    insert into public.price_tier_rule_notes (rule_id, note, verified)
    select id, note, coalesce(verified, false)
      from public.price_tier_rules
     where note is not null or coalesce(verified, false)
    on conflict (rule_id) do update
      set note = excluded.note, verified = excluded.verified, updated_at = now();
  end if;
end $$;

alter table public.price_tier_rules
  drop column if exists note,
  drop column if exists verified;

-- 5. audit trail (created after the copy so the one-off migration copy is not logged as edits) ---
-- A dedicated trigger function, not the shared audit_row_change(): that function identifies the
-- changed row via coalesce(id, user_id, location_id), none of which exist on this table (its
-- primary key is rule_id). Using it unchanged would silently write entity_id = NULL on every
-- note change. audit_row_change() itself is left untouched since other tables' triggers rely on
-- its existing id / user_id / location_id lookup.
create or replace function public.audit_price_rule_note_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), current_actor_role(), 'price_tier_rule_notes.' || lower(tg_op),
          'price_tier_rule_notes', coalesce(new.rule_id, old.rule_id)::text,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

drop trigger if exists audit_price_rule_notes on public.price_tier_rule_notes;
create trigger audit_price_rule_notes
  after insert or update or delete on public.price_tier_rule_notes
  for each row execute function public.audit_price_rule_note_change();

notify pgrst, 'reload schema';
