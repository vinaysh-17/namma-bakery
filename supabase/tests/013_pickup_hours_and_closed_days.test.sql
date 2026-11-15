-- Run with: supabase test db
-- Pickup hours and closed days validation regression test suite (GitHub issue #73).
-- Verifies that public.place_order correctly enforces:
--   1. Weekly closed weekdays (returns CLOSED_DAY)
--   2. Special calendar closures (returns CLOSED_DAY)
--   3. Valid final slot ending exactly at closing (accepted)
--   4. Slot extending beyond closing (returns OUTSIDE_OPENING_HOURS)
--   5. Slot starting exactly at closing (returns OUTSIDE_OPENING_HOURS)
--   6. Slot starting before opening (returns OUTSIDE_OPENING_HOURS)
--   7. Unaligned slot intervals / non-zero seconds (returns OUTSIDE_OPENING_HOURS)
--   8. Valid aligned slot within operating hours (accepted)
--   9. Idempotency replay (#98) succeeds
--  10. Slot capacity protection still returns SLOT_FULL

begin;
select plan(21);

-- Fixtures
create temp table ctx as
select
  l.id as loc,
  l.timezone as tz,
  (date_trunc('day', now() at time zone l.timezone) + interval '7 days')::date as open_date,
  (date_trunc('day', now() at time zone l.timezone) + interval '8 days')::date as closed_date,
  (date_trunc('day', now() at time zone l.timezone) + interval '9 days')::date as special_date,
  (date_trunc('day', now() at time zone l.timezone) + interval '10 days')::date as overlap_date
from locations l
where l.is_active
limit 1;
grant select on ctx to anon, authenticated, service_role;

-- Deterministic operating schedule for testing:
-- 1. open_date: Configured open 10:00:00 to 21:30:00
insert into business_hours (location_id, weekday, opens, closes)
values ((select loc from ctx), extract(dow from (select open_date from ctx))::smallint, '10:00:00', '21:30:00')
on conflict (location_id, weekday, opens) do update set closes = '21:30:00';

-- 2. closed_date: Delete business_hours entry for this weekday (weekly closed day)
delete from business_hours
where location_id = (select loc from ctx)
  and weekday = extract(dow from (select closed_date from ctx))::smallint;

-- 3. special_date: Keep business_hours active but add an entry in special_closures
insert into business_hours (location_id, weekday, opens, closes)
values ((select loc from ctx), extract(dow from (select special_date from ctx))::smallint, '10:00:00', '21:30:00')
on conflict (location_id, weekday, opens) do update set closes = '21:30:00';

insert into special_closures (location_id, closure_date, reason)
values ((select loc from ctx), (select special_date from ctx), 'Scheduled maintenance closure');

-- 4. overlap_date: Configured open 10:00:00 to 21:15:00 (closing time is not a multiple of slot duration)
insert into business_hours (location_id, weekday, opens, closes)
values ((select loc from ctx), extract(dow from (select overlap_date from ctx))::smallint, '10:00:00', '21:15:00')
on conflict (location_id, weekday, opens) do update set closes = '21:15:00';

-- Helper: simple cart item using Black Forest cake
create function pg_temp.items() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object(
      'product_id', id,
      'weight_grams', 1000,
      'egg_type', 'EGGLESS',
      'quantity', 1
    )
  )
  from products
  where slug = 'black-forest'
$$;
grant execute on function pg_temp.items() to service_role;

create temp table results (label text, order_id uuid, order_number text, public_token text, replayed boolean);
grant all on results to service_role;

set local role service_role;

-- ----------------------------------------------------------------
-- 1. Weekly closed weekday returns CLOSED_DAY
-- ----------------------------------------------------------------
select throws_ok(
  $$ select place_order(
       (select loc from ctx), null, 'Customer One', '9845200001', null,
       ((select closed_date from ctx) + time '11:00:00') at time zone (select tz from ctx),
       null, pg_temp.items()
     ) $$,
  'CLOSED_DAY',
  'Weekly closed weekday is rejected with CLOSED_DAY'
);

select is(
  (select count(*)::int from orders where customer_phone = '9845200001'),
  0,
  'No order created for weekly closed day'
);

-- ----------------------------------------------------------------
-- 2. Special closure date returns CLOSED_DAY
-- ----------------------------------------------------------------
select throws_ok(
  $$ select place_order(
       (select loc from ctx), null, 'Customer Two', '9845200002', null,
       ((select special_date from ctx) + time '11:00:00') at time zone (select tz from ctx),
       null, pg_temp.items()
     ) $$,
  'CLOSED_DAY',
  'Special closure date is rejected with CLOSED_DAY'
);

select is(
  (select count(*)::int from orders where customer_phone = '9845200002'),
  0,
  'No order created for special closure date'
);

-- ----------------------------------------------------------------
-- 3. Valid final slot ending exactly at closing is accepted
-- ----------------------------------------------------------------
-- Hours: 10:00 to 21:30, slot_minutes: 30. Final slot starts at 21:00:00.
insert into results
select 'final_slot', * from place_order(
  (select loc from ctx), null, 'Customer Three', '9845200003', null,
  ((select open_date from ctx) + time '21:00:00') at time zone (select tz from ctx),
  null, pg_temp.items()
);

select matches(
  (select order_number from results where label = 'final_slot'),
  '^NB[0-9]+$',
  'Valid final slot ending exactly at closing is accepted'
);

-- ----------------------------------------------------------------
-- 4. Slot extending beyond closing is rejected (OUTSIDE_OPENING_HOURS)
-- ----------------------------------------------------------------
-- Hours on overlap_date: 10:00:00 to 21:15:00, slot_minutes: 30.
-- Slot at 21:00:00 is perfectly aligned with the 10:00:00 grid (11 hours = 22 * 30 min)
-- and starts before closing (21:00:00 < 21:15:00), but completes at 21:30:00 (> 21:15:00 closes).
-- This isolates the closing-overlap condition: alignment passes, but slot duration exceeds closing.
select throws_ok(
  $$ select place_order(
       (select loc from ctx), null, 'Customer Four', '9845200004', null,
       ((select overlap_date from ctx) + time '21:00:00') at time zone (select tz from ctx),
       null, pg_temp.items()
     ) $$,
  'OUTSIDE_OPENING_HOURS',
  'Aligned slot extending beyond closing is rejected with OUTSIDE_OPENING_HOURS'
);

select is(
  (select count(*)::int from orders where customer_phone = '9845200004'),
  0,
  'No order created for slot extending beyond closing'
);

-- ----------------------------------------------------------------
-- 5. Slot starting exactly at closing is rejected (OUTSIDE_OPENING_HOURS)
-- ----------------------------------------------------------------
select throws_ok(
  $$ select place_order(
       (select loc from ctx), null, 'Customer Five', '9845200005', null,
       ((select open_date from ctx) + time '21:30:00') at time zone (select tz from ctx),
       null, pg_temp.items()
     ) $$,
  'OUTSIDE_OPENING_HOURS',
  'Slot starting exactly at closing is rejected with OUTSIDE_OPENING_HOURS'
);

select is(
  (select count(*)::int from orders where customer_phone = '9845200005'),
  0,
  'No order created for slot starting at closing'
);

-- ----------------------------------------------------------------
-- 6. Slot before opening is rejected (OUTSIDE_OPENING_HOURS)
-- ----------------------------------------------------------------
-- Opening is 10:00:00; 09:30:00 is before opening.
select throws_ok(
  $$ select place_order(
       (select loc from ctx), null, 'Customer Six', '9845200006', null,
       ((select open_date from ctx) + time '09:30:00') at time zone (select tz from ctx),
       null, pg_temp.items()
     ) $$,
  'OUTSIDE_OPENING_HOURS',
  'Slot before opening is rejected with OUTSIDE_OPENING_HOURS'
);

select is(
  (select count(*)::int from orders where customer_phone = '9845200006'),
  0,
  'No order created for slot before opening'
);

-- ----------------------------------------------------------------
-- 7. Unaligned slot is rejected (OUTSIDE_OPENING_HOURS)
-- ----------------------------------------------------------------
-- 7a. Unaligned minutes: 10:15:00 (slot interval is 30 mins, valid: 10:00, 10:30)
select throws_ok(
  $$ select place_order(
       (select loc from ctx), null, 'Customer Seven', '9845200007', null,
       ((select open_date from ctx) + time '10:15:00') at time zone (select tz from ctx),
       null, pg_temp.items()
     ) $$,
  'OUTSIDE_OPENING_HOURS',
  'Unaligned slot interval (minutes) is rejected with OUTSIDE_OPENING_HOURS'
);

-- 7b. Non-zero seconds: 10:00:15
select throws_ok(
  $$ select place_order(
       (select loc from ctx), null, 'Customer Seven B', '9845200077', null,
       ((select open_date from ctx) + time '10:00:15') at time zone (select tz from ctx),
       null, pg_temp.items()
     ) $$,
  'OUTSIDE_OPENING_HOURS',
  'Slot with non-zero seconds is rejected with OUTSIDE_OPENING_HOURS'
);

select is(
  (select count(*)::int from orders where customer_phone in ('9845200007', '9845200077')),
  0,
  'No order created for unaligned slots'
);

-- ----------------------------------------------------------------
-- 8. Valid aligned slot within operating hours is accepted
-- ----------------------------------------------------------------
insert into results
select 'aligned_slot', * from place_order(
  (select loc from ctx), null, 'Customer Eight', '9845200008', null,
  ((select open_date from ctx) + time '11:00:00') at time zone (select tz from ctx),
  null, pg_temp.items(), 'slot-valid-key-0001'
);

select matches(
  (select order_number from results where label = 'aligned_slot'),
  '^NB[0-9]+$',
  'Valid aligned slot within operating hours is accepted'
);

select is(
  (select replayed from results where label = 'aligned_slot'),
  false,
  'Fresh order placement is not flagged as replayed'
);

-- ----------------------------------------------------------------
-- 9. #98 idempotency replay succeeds after order creation
-- ----------------------------------------------------------------
insert into results
select 'replay_slot', * from place_order(
  (select loc from ctx), null, 'Customer Eight', '9845200008', null,
  ((select open_date from ctx) + time '11:00:00') at time zone (select tz from ctx),
  null, pg_temp.items(), 'slot-valid-key-0001'
);

select is(
  (select order_number from results where label = 'replay_slot'),
  (select order_number from results where label = 'aligned_slot'),
  'Idempotent replay returns the existing order number'
);

select is(
  (select replayed from results where label = 'replay_slot'),
  true,
  'Idempotent replay is flagged as replayed'
);

select is(
  (select count(*)::int from orders where idempotency_key = 'slot-valid-key-0001'),
  1,
  'Idempotent replay creates no second order in the database'
);

-- ----------------------------------------------------------------
-- 10. Slot capacity protection still returns SLOT_FULL
-- ----------------------------------------------------------------
reset role;
update store_settings set max_orders_per_slot = 1 where location_id = (select loc from ctx);
set local role service_role;

select throws_ok(
  $$ select place_order(
       (select loc from ctx), null, 'Customer Ten', '9845200010', null,
       ((select open_date from ctx) + time '11:00:00') at time zone (select tz from ctx),
       null, pg_temp.items(), 'slot-full-key-0001'
     ) $$,
  'SLOT_FULL',
  'Order placed into a full slot is rejected with SLOT_FULL'
);

select is(
  (select count(*)::int from orders where customer_phone = '9845200010'),
  0,
  'No order created when slot is full'
);

reset role;

select * from finish();
rollback;

