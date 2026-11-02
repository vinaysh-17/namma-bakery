-- 0016: Keep staff internal notes on custom cake requests away from customers (#56).
--
-- Staff notes added from "Staff Messages & Internal Notes" were stored as ordinary
-- STAFF request_messages and shown to the customer on /custom-cake/track. This adds an
-- is_internal flag, marks staff notes as internal, and hides internal messages from
-- every customer-facing read (RLS and get_request_by_token). The app's service-role
-- reads filter on the same flag.
--
-- Messages that staff intend for the customer (the reason given when a request is
-- declined) stay customer-visible.

alter table public.request_messages
  add column if not exists is_internal boolean not null default false;

-- Backfill. Until now, STAFF messages came from two places:
--   * post_request_message_staff  -> internal notes
--   * staff_review_request         -> the decline reason, also stored in custom_cake_requests.decline_reason
-- Keep the decline reasons visible and mark every other STAFF message as internal.
update public.request_messages m
   set is_internal = true
 where m.sender = 'STAFF'
   and not exists (
     select 1
       from public.custom_cake_requests r
      where r.id = m.request_id
        and r.decline_reason is not null
        and left(r.decline_reason, 1000) = m.body
   );

-- Staff notes are internal from now on.
create or replace function public.post_request_message_staff(p_request_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into request_messages (request_id, sender, staff_id, body, is_internal)
  values (p_request_id, 'STAFF', auth.uid(), p_body, true);
end $$;

-- Customer view by token: never include internal messages.
create or replace function public.get_request_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'request_number', r.request_number, 'status', r.status, 'first_name', split_part(r.customer_name,' ',1),
    'flavour', r.flavour, 'egg_type', r.egg_type, 'weight_grams', r.weight_grams, 'message_on_cake', r.message_on_cake,
    'preferred_pickup_at', r.preferred_pickup_at, 'decline_reason', r.decline_reason,
    'quote', (select jsonb_build_object('price_paise', q.price_paise, 'confirmed_pickup_at', q.confirmed_pickup_at,
                'bakery_note', q.bakery_note, 'valid_until', q.valid_until)
              from custom_cake_quotes q where q.request_id = r.id and q.superseded_at is null),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body, 'at', m.created_at) order by m.created_at)
                from request_messages m where m.request_id = r.id and not m.is_internal), '[]'::jsonb),
    'order_token', (select o.public_token from orders o where o.custom_request_id = r.id))
  from custom_cake_requests r where r.public_token = p_token
$$;

-- Signed-in customers can read their own non-internal messages; staff can read everything.
drop policy if exists request_messages_read on public.request_messages;
create policy request_messages_read on public.request_messages for select to authenticated
  using (
    is_staff()
    or (
      not is_internal
      and exists (select 1 from custom_cake_requests r where r.id = request_id and r.customer_id = auth.uid())
    )
  );
