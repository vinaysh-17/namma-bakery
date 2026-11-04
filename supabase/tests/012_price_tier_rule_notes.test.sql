-- Run with: supabase test db
-- Internal cake price-rule notes are admin-only (GitHub issue #72) - requires migration 0024.
begin;
select plan(19);

-- fixtures (run as superuser)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000c72', 'customer72@test'),
  ('00000000-0000-0000-0000-000000000e72', 'employee72@test'),
  ('00000000-0000-0000-0000-000000000d72', 'admin72@test');
insert into staff_roles (user_id, role) values
  ('00000000-0000-0000-0000-000000000e72', 'EMPLOYEE'),
  ('00000000-0000-0000-0000-000000000d72', 'ADMIN');

create temp table ctx72 as
select (select id from price_tier_rules order by id limit 1) as rule_id,
       (select id from locations limit 1) as loc,
       ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 12 hours') at time zone 'Asia/Kolkata') as pickup;
grant select on ctx72 to anon, authenticated, service_role;

-- an existing internal note on a rule (as migrated from the old columns)
insert into price_tier_rule_notes (rule_id, note, verified)
values ((select rule_id from ctx72), 'Checking', true)
on conflict (rule_id) do update set note = excluded.note, verified = excluded.verified;

-- 1. schema: the fields moved out of the customer-readable table
select has_table('public', 'price_tier_rule_notes', 'the admin-only notes table exists');
select hasnt_column('public', 'price_tier_rules', 'note', 'price_tier_rules no longer has a note column');
select hasnt_column('public', 'price_tier_rules', 'verified', 'price_tier_rules no longer has a verified column');
select is((select relrowsecurity from pg_class where oid = 'public.price_tier_rule_notes'::regclass), true, 'RLS is enabled on the notes table');
select is(has_table_privilege('anon', 'public.price_tier_rule_notes', 'select'), false, 'anon has no SELECT privilege on the notes table');
select ok((select count(*) from price_tier_rule_notes where note is not null and note <> 'Checking') > 0, 'migrated / seeded notes are present in the notes table');

-- 2. anonymous visitors (public API with the publishable key)
set local role anon;
select throws_ok($$ select * from price_tier_rule_notes $$, '42501', null, 'anon cannot read internal notes');
select throws_ok($$ select note from price_tier_rules $$, '42703', null, 'anon cannot read a note column on price rules (it no longer exists)');
reset role;

-- 3. a signed-in customer (authenticated, not staff)
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000c72', true);
select is((select count(*)::int from price_tier_rule_notes), 0, 'a signed-in customer sees no internal notes');
select throws_ok(
  $$ insert into price_tier_rule_notes (rule_id, note) values ((select rule_id from ctx72), 'x') on conflict (rule_id) do update set note = 'x' $$,
  '42501', null, 'a signed-in customer cannot write internal notes');
reset role;

-- 4. an employee (staff but not admin): notes are admin-only
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000e72', true);
select is((select count(*)::int from price_tier_rule_notes), 0, 'an employee (non-admin staff) sees no internal notes');
select throws_ok(
  $$ insert into price_tier_rule_notes (rule_id, note) values ((select rule_id from ctx72), 'x') on conflict (rule_id) do update set note = 'x' $$,
  '42501', null, 'an employee (non-admin staff) cannot write internal notes');
reset role;

-- 5. an admin reads, edits and clears notes with their own session
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000d72', true);
select ok((select count(*) from price_tier_rule_notes where rule_id = (select rule_id from ctx72) and note = 'Checking') = 1, 'an admin can read the internal note');
-- same upsert the admin action sends: only the note column, so verified is kept
select lives_ok(
  $$ insert into price_tier_rule_notes (rule_id, note) values ((select rule_id from ctx72), 'Confirmed with kitchen head')
     on conflict (rule_id) do update set note = excluded.note $$,
  'an admin can save a note');
select is((select verified from price_tier_rule_notes where rule_id = (select rule_id from ctx72)), true, 'saving the note keeps the existing verified flag');
update price_tier_rule_notes set note = null where rule_id = (select rule_id from ctx72);
select is((select note from price_tier_rule_notes where rule_id = (select rule_id from ctx72)), null, 'an admin can clear a note');
reset role;

-- 6. note changes are audit-logged, as changes to the old columns were, and correctly linked to
--    the rule they belong to (the shared audit_row_change() trigger would have left entity_id
--    NULL here, since this table's primary key is rule_id, not id/user_id/location_id)
select ok((select count(*) from audit_logs where entity_type = 'price_tier_rule_notes') > 0, 'internal note changes are audit-logged');
select is(
  (select count(*) from audit_logs
    where entity_type = 'price_tier_rule_notes'
      and entity_id is distinct from (select rule_id::text from ctx72)),
  0::bigint,
  'every price-rule-note audit entry has entity_id set to the affected rule (none NULL or wrong)'
);

-- 7. customer cake pricing and ordering are unaffected
set local role service_role;
select matches(
  (select order_number from place_order((select loc from ctx72), null, 'Notes Test', '9845700001', null, (select pickup from ctx72), null,
     jsonb_build_array(jsonb_build_object('product_id', (select id from products where slug = 'black-forest'),
                                          'weight_grams', 1000, 'egg_type', 'EGGLESS', 'quantity', 1)))),
  '^NB[0-9]+$', 'a cake order is still priced and placed from the price rules');
reset role;

select * from finish();
rollback;
