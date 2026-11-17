-- Run with: supabase test db
-- Tests for Migration 0028: Suppress duplicate NEW_ORDER notification for custom cake orders (#100)
begin;
select plan(6);

-- Setup context and IDs
create temp table test_vars as
select
  (select id from locations limit 1) as loc_id,
  gen_random_uuid() as regular_order_id,
  gen_random_uuid() as custom_req_id,
  gen_random_uuid() as custom_order_id;

-- 1. Insert a regular order (custom_request_id is NULL)
insert into orders (
  id,
  order_number,
  location_id,
  customer_name,
  customer_phone,
  requested_pickup_at,
  custom_request_id
)
select
  regular_order_id,
  'NB-TEST-REG-01',
  loc_id,
  'Regular Customer',
  '9845100001',
  now() + interval '1 day',
  null
from test_vars;

-- Verify regular order generates a NEW_ORDER notification
select is(
  (select count(*)::int from portal_notifications where related_entity_id = (select regular_order_id::text from test_vars)),
  1,
  'Regular order generates exactly one portal notification'
);

select is(
  (select type from portal_notifications where related_entity_id = (select regular_order_id::text from test_vars)),
  'NEW_ORDER',
  'Regular order notification type is NEW_ORDER'
);

-- The unchanged parts of the original trigger still apply to regular orders
select is(
  (select title || ' | ' || link_url from portal_notifications
    where related_entity_id = (select regular_order_id::text from test_vars)),
  'New Order Received | /staff?tab=ORDERS&orderId=' || (select regular_order_id::text from test_vars),
  'Regular order notification keeps its title and staff deep link'
);

-- 2. Insert a custom cake request
insert into custom_cake_requests (
  id,
  request_number,
  location_id,
  customer_name,
  customer_phone,
  flavour,
  egg_type,
  weight_grams,
  preferred_pickup_at
)
select
  custom_req_id,
  'CC-TEST-01',
  loc_id,
  'Custom Customer',
  '9845100002',
  'Chocolate Truffle',
  'EGGLESS',
  1000,
  now() + interval '2 days'
from test_vars;

-- Verify custom cake request created a NEW_CUSTOM_CAKE notification
select is(
  (select count(*)::int from portal_notifications where related_entity_id = (select custom_req_id::text from test_vars)),
  1,
  'Custom cake request generated NEW_CUSTOM_CAKE notification'
);

-- 3. Insert an order converted from that custom cake request (custom_request_id is NOT NULL)
insert into orders (
  id,
  order_number,
  location_id,
  customer_name,
  customer_phone,
  requested_pickup_at,
  custom_request_id
)
select
  custom_order_id,
  'NB-TEST-CC-01',
  loc_id,
  'Custom Customer',
  '9845100002',
  now() + interval '2 days',
  custom_req_id
from test_vars;

-- Verify that NO portal notification was generated for this converted order
select is(
  (select count(*)::int from portal_notifications where related_entity_id = (select custom_order_id::text from test_vars)),
  0,
  'Converted custom cake order does NOT generate a duplicate NEW_ORDER notification'
);

-- 4. Verify total notifications for this custom cake workflow is still 1 (only NEW_CUSTOM_CAKE, not NEW_ORDER)
select is(
  (select count(*)::int from portal_notifications where related_entity_id in (
    select custom_req_id::text from test_vars
    union
    select custom_order_id::text from test_vars
  )),
  1,
  'Total notifications for custom cake lifecycle is exactly 1 (NEW_CUSTOM_CAKE only)'
);

select * from finish();
rollback;

