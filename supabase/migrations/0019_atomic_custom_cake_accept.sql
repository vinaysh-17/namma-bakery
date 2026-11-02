-- 0019: Accept a custom cake request in one transaction (#63).
--
-- The Staff Portal accepted a request with three separate RPC calls:
--   staff_review_request -> staff_send_quote -> customer_accept_quote
-- Each call committed on its own. When the last one failed (DAY_FULL when the custom
-- cake limit for that day was reached, for example) the request was left as QUOTED with
-- an active quote but no order. The customer saw "Confirmed by Bakery" and a price, there
-- was no order, and the request stayed open forever, counting toward the customer's
-- open-request limit.
--
-- staff_accept_custom_request runs the same three steps inside one function, so they
-- share one transaction: either the order is created, or nothing changes. The existing
-- functions are reused unchanged, so every check they make still applies.

create or replace function public.staff_accept_custom_request(
  p_request_id uuid,
  p_price_paise int,
  p_confirmed_pickup timestamptz,
  p_note text default null
) returns table (order_number text, public_token text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r custom_cake_requests;
begin
  if not is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into r from custom_cake_requests c where c.id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status not in ('SUBMITTED','UNDER_REVIEW','NEEDS_CLARIFICATION','QUOTED') then
    raise exception 'INVALID_TRANSITION: %', r.status using errcode = 'P0001';
  end if;

  if r.status = 'SUBMITTED' then
    perform staff_review_request(r.id, 'UNDER_REVIEW', null);
  end if;
  perform staff_send_quote(r.id, p_price_paise, 0, p_confirmed_pickup, p_note);

  -- Raises DAY_FULL, QUOTE_EXPIRED, etc. Any exception here rolls back the two steps above.
  return query select a.order_number, a.public_token from customer_accept_quote(r.public_token) a;
end $$;

revoke all on function public.staff_accept_custom_request(uuid, int, timestamptz, text) from public, anon;
grant execute on function public.staff_accept_custom_request(uuid, int, timestamptz, text) to authenticated, service_role;

-- Repair requests already stuck by a failed accept. QUOTED is only ever reached through
-- the Staff Portal accept (customers have no quote screen), so a QUOTED request without
-- an order is one whose accept failed part-way. Put it back in review and retire the
-- leftover quote, so the customer no longer sees a price as agreed and staff can accept
-- it again.
update public.custom_cake_quotes q
   set superseded_at = now()
 where q.superseded_at is null
   and exists (
     select 1 from public.custom_cake_requests r
      where r.id = q.request_id
        and r.status = 'QUOTED'
        and not exists (select 1 from public.orders o where o.custom_request_id = r.id)
   );

update public.custom_cake_requests r
   set status = 'UNDER_REVIEW'
 where r.status = 'QUOTED'
   and not exists (select 1 from public.orders o where o.custom_request_id = r.id);
