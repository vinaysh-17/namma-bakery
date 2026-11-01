-- Migration: 0013_staff_order_history_list.sql
--
-- Read-only, staff-visible Order History listing with an order TYPE filter.
-- (Deletion stays admin-only and unchanged: admin_delete_order_history / purge_old_order_history
--  from 0012 are not touched by this migration.)
--
-- Types:
--   normal  - terminal orders that were NOT created from a custom cake request
--   custom  - custom cake history records
--   all     - both
--
-- Custom cake model (verified against 0001/0002): a custom cake request (CC...) is the
-- enquiry; accepting it creates ONE linked order (NB..., orders.custom_request_id). The
-- request is therefore the single history record for a custom cake - its linked order is
-- NOT listed again as a normal order. A custom cake is "history" when:
--   * it has a linked order whose status is terminal (COMPLETED/REJECTED/CANCELLED/NO_SHOW), or
--   * it has no linked order and the request itself ended (DECLINED, CUSTOMER_DECLINED,
--     EXPIRED, WITHDRAWN).
-- A legacy CUSTOMER_ACCEPTED request without a linked order is still active and not listed.
--
-- Date filtering uses created_at (when the order / request was placed), as in 0012.
-- Authorization: any ACTIVE staff member or admin (is_staff()); anon/unauthenticated rejected.

create or replace function public.staff_list_order_history(
  p_from timestamptz, p_to timestamptz, p_type text default 'all', p_limit int default 300)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 300), 1), 500);
  v_type  text := coalesce(p_type, 'all');
  v_total int;
  v_items jsonb;
begin
  if not is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_type not in ('all','normal','custom') then raise exception 'INVALID_TYPE' using errcode = 'P0001'; end if;

  with h as (
    select 'normal'::text as kind, o.id, o.order_number as number, o.status::text as status,
           o.created_at, o.total_paise, o.payment_status::text as payment_status,
           null::text as request_status, null::text as linked_order_number, null::uuid as linked_order_id,
           true as deletable
      from orders o
     where v_type in ('all','normal')
       and o.status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW')
       and o.custom_request_id is null
       and (p_from is null or o.created_at >= p_from) and (p_to is null or o.created_at < p_to)
    union all
    select 'custom', r.id, r.request_number,
           coalesce(lo.status::text,
                    case r.status::text when 'DECLINED' then 'REJECTED' else 'CANCELLED' end),
           r.created_at,
           coalesce(lo.total_paise,
                    (select q.price_paise from custom_cake_quotes q where q.request_id = r.id order by q.created_at desc limit 1),
                    0),
           coalesce(lo.payment_status::text, 'unpaid'),
           r.status::text, lo.order_number, lo.id,
           false
      from custom_cake_requests r
      left join orders lo on lo.custom_request_id = r.id
     where v_type in ('all','custom')
       and ((lo.id is not null and lo.status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW'))
         or (lo.id is null and r.status in ('DECLINED','CUSTOMER_DECLINED','EXPIRED','WITHDRAWN')))
       and (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to)
  )
  select (select count(*) from h),
         coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_total, v_items
    from (select * from h order by created_at desc limit v_limit) x;

  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

revoke execute on function public.staff_list_order_history(timestamptz, timestamptz, text, int) from public, anon;
grant execute on function public.staff_list_order_history(timestamptz, timestamptz, text, int) to authenticated, service_role;

-- Make PostgREST pick up the new function immediately (also happens automatically on DDL).
notify pgrst, 'reload schema';
