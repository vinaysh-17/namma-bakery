-- Migration: 0014_custom_cake_history_deletion.sql
--
-- Makes historical CUSTOM CAKE orders deletable with the same admin-only, all-or-nothing,
-- audited workflow as regular orders (0012), and aligns their history date with regular orders.
-- Requires 0012 and 0013 to be applied first. Safe to re-run (create or replace only; no table
-- or data changes). Signatures of the existing functions are unchanged.
--
-- Data model (verified against 0001_schema.sql / 0002_functions.sql):
--   custom_cake_requests (CCxxxx)  <--  orders.custom_request_id (NBxxxx, unique, NO cascade)
--   Children of a request that cascade on delete: custom_cake_images, custom_cake_quotes,
--   request_messages, notifications. Children of an order that cascade: order_items,
--   order_status_history, order_internal_notes, notifications. payments.order_id has NO cascade.
--
-- What "delete a historical custom cake" removes (one transaction):
--   1. the linked order (NBxxxx) with its items / status history / notes / payments, then
--   2. the custom cake request (CCxxxx) with its images rows, quotes, messages, notifications.
--   The request MUST go with its order: a request left behind without its order would fall back
--   to the legacy "accepted" stage and reappear as an ACTIVE custom cake in the staff queue.
--   Reference-photo FILES live in the private storage bucket 'cake-references' and cannot be
--   removed by SQL; the function returns their paths and the admin server action deletes them
--   after the database commit.
--   Retained: customers/profiles, products, audit_logs, all other records.
--
-- History eligibility of a custom cake (unchanged from 0013):
--   * linked order exists and is COMPLETED / REJECTED / CANCELLED / NO_SHOW, or
--   * no linked order and the request ended: DECLINED / CUSTOMER_DECLINED / EXPIRED / WITHDRAWN.
--   Active custom cakes can never be deleted.
--
-- History DATE of a custom cake = the linked order's created_at when it has one (the same date a
-- regular order uses), otherwise the request's created_at. Day / week / month / range filters
-- and the displayed "Placed" date therefore behave exactly like regular orders.
--
-- Automatic 3-month retention (purge_old_order_history) is intentionally NOT changed: it keeps
-- cleaning regular orders only. Custom cake history is removed by admins on demand.

-- ---------------------------------------------------------------- internal delete helper
-- p_ids may contain regular order ids and/or custom cake REQUEST ids.
create or replace function public._delete_history_orders(p_ids uuid[], p_method text, p_detail jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ids       uuid[];
  v_req       uuid[];   -- custom cake request ids
  v_reg       uuid[];   -- regular order ids
  v_link      uuid[];   -- orders linked to the custom cake requests
  v_all_ord   uuid[];
  v_bad       text[];
  v_numbers   text[];
  v_linked_no text[];
  v_paths     text[];
  v_reg_n     int;
  v_req_n     int;
  v_total     bigint;
  v_pay_n     int;
  v_pay_sum   bigint;
begin
  select coalesce(array_agg(distinct i), '{}') into v_ids from unnest(coalesce(p_ids, '{}')) as i;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('deleted', 0, 'order_numbers', '[]'::jsonb, 'total_paise', 0, 'storage_paths', '[]'::jsonb);
  end if;

  select coalesce(array_agg(id), '{}') into v_req from custom_cake_requests where id = any(v_ids);
  v_reg := array(select i from unnest(v_ids) i where not (i = any(v_req)));

  -- lock everything involved so statuses cannot change between the check and the delete
  perform 1 from orders where id = any(v_reg) or custom_request_id = any(v_req) for update;
  perform 1 from custom_cake_requests where id = any(v_req) for update;

  -- ANY requested record that is missing / active / not history aborts the whole delete
  select array_agg(x) into v_bad from (
    select coalesce(o.order_number, i::text) as x
      from unnest(v_reg) as i
      left join orders o on o.id = i
     where o.id is null
        or o.status not in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW')
        or o.custom_request_id is not null          -- custom cake orders are deleted via their request
    union all
    select r.request_number
      from custom_cake_requests r
      left join orders lo on lo.custom_request_id = r.id
     where r.id = any(v_req)
       and not ((lo.id is not null and lo.status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW'))
             or (lo.id is null and r.status in ('DECLINED','CUSTOMER_DECLINED','EXPIRED','WITHDRAWN')))
  ) b;
  if v_bad is not null then
    raise exception 'ORDERS_NOT_ELIGIBLE: %', array_to_string(v_bad, ', ') using errcode = 'P0001';
  end if;

  v_link := coalesce((select array_agg(id) from orders where custom_request_id = any(v_req)), '{}');
  v_all_ord := v_reg || v_link;

  v_reg_n := cardinality(v_reg);
  v_req_n := cardinality(v_req);

  select array_agg(n order by n) into v_numbers from (
    select order_number as n from orders where id = any(v_reg)
    union all
    select request_number from custom_cake_requests where id = any(v_req)
  ) q;
  select array_agg(order_number order by order_number) into v_linked_no from orders where id = any(v_link);

  select coalesce((select sum(total_paise) from orders where id = any(v_reg)), 0)
       + coalesce((select sum(coalesce(lo.total_paise,
                    (select q.price_paise from custom_cake_quotes q where q.request_id = r.id order by q.created_at desc limit 1), 0))
                   from custom_cake_requests r left join orders lo on lo.custom_request_id = r.id
                  where r.id = any(v_req)), 0)
    into v_total;

  select count(*), coalesce(sum(amount_paise), 0) into v_pay_n, v_pay_sum
    from payments where order_id = any(v_all_ord);
  select coalesce(array_agg(storage_path), '{}') into v_paths from custom_cake_images where request_id = any(v_req);

  -- audit FIRST (audit_logs has no FK, so it survives the deletion)
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after_data)
  values (auth.uid(), current_actor_role(), 'order_history.deleted', 'orders', null,
          jsonb_build_object(
            'method', p_method,
            'count', v_reg_n + v_req_n,
            'regular_count', v_reg_n,
            'custom_cake_count', v_req_n,
            'order_numbers', to_jsonb(v_numbers[1:500]),
            'linked_order_numbers', to_jsonb((coalesce(v_linked_no, '{}'::text[]))[1:500]),
            'total_paise', v_total,
            'payments_removed', v_pay_n,
            'payments_paise', v_pay_sum,
            'reference_images', cardinality(v_paths)
          ) || coalesce(p_detail, '{}'::jsonb));

  delete from payments where order_id = any(v_all_ord);
  delete from orders   where id = any(v_all_ord);                -- items / history / notes / notifications cascade
  delete from custom_cake_requests where id = any(v_req);        -- images / quotes / messages / notifications cascade

  return jsonb_build_object('deleted', v_reg_n + v_req_n, 'order_numbers', to_jsonb(v_numbers),
                            'total_paise', v_total, 'storage_paths', to_jsonb(v_paths));
end $$;

-- ---------------------------------------------------------------- admin: preview a deletion
create or replace function public.admin_preview_order_deletion(p_order_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if cardinality(coalesce(p_order_ids, '{}')) > 1000 then raise exception 'TOO_MANY_ORDERS' using errcode = 'P0001'; end if;

  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select o.id, o.order_number, o.status::text as status, o.created_at, o.total_paise,
               (o.status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW') and o.custom_request_id is null) as eligible,
               'normal'::text as kind
          from orders o where o.id = any(p_order_ids)
        union all
        select r.id, r.request_number,
               coalesce(lo.status::text, case r.status::text when 'DECLINED' then 'REJECTED' else 'CANCELLED' end),
               coalesce(lo.created_at, r.created_at),
               coalesce(lo.total_paise,
                        (select q.price_paise from custom_cake_quotes q where q.request_id = r.id order by q.created_at desc limit 1), 0),
               ((lo.id is not null and lo.status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW'))
                or (lo.id is null and r.status in ('DECLINED','CUSTOMER_DECLINED','EXPIRED','WITHDRAWN'))),
               'custom'
          from custom_cake_requests r left join orders lo on lo.custom_request_id = r.id
         where r.id = any(p_order_ids)
      ) x
    ), '[]'::jsonb),
    'missing', (select count(*) from unnest(p_order_ids) i
                 where not exists (select 1 from orders o where o.id = i)
                   and not exists (select 1 from custom_cake_requests r where r.id = i))
  );
end $$;

-- ---------------------------------------------------------------- admin: delete (atomic)
create or replace function public.admin_delete_order_history(p_order_ids uuid[], p_method text, p_range jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_method is null or p_method not in ('individual','selected','day','week','month','range') then
    raise exception 'INVALID_METHOD' using errcode = 'P0001';
  end if;
  if cardinality(coalesce(p_order_ids, '{}')) = 0 then raise exception 'NOTHING_SELECTED' using errcode = 'P0001'; end if;
  if cardinality(p_order_ids) > 1000 then raise exception 'TOO_MANY_ORDERS' using errcode = 'P0001'; end if;

  return _delete_history_orders(p_order_ids, p_method, jsonb_build_object('range', p_range));
end $$;

-- ---------------------------------------------------------------- staff/admin: list (read-only)
-- Same signature as 0013. Changes: custom cake records are now deletable (admin UI only) and use
-- the linked order's created_at as their history date (like regular orders).
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
           coalesce(lo.created_at, r.created_at),
           coalesce(lo.total_paise,
                    (select q.price_paise from custom_cake_quotes q where q.request_id = r.id order by q.created_at desc limit 1),
                    0),
           coalesce(lo.payment_status::text, 'unpaid'),
           r.status::text, lo.order_number, lo.id,
           true
      from custom_cake_requests r
      left join orders lo on lo.custom_request_id = r.id
     where v_type in ('all','custom')
       and ((lo.id is not null and lo.status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW'))
         or (lo.id is null and r.status in ('DECLINED','CUSTOMER_DECLINED','EXPIRED','WITHDRAWN')))
       and (p_from is null or coalesce(lo.created_at, r.created_at) >= p_from)
       and (p_to   is null or coalesce(lo.created_at, r.created_at) <  p_to)
  )
  select (select count(*) from h),
         coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_total, v_items
    from (select * from h order by created_at desc limit v_limit) x;

  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

-- ---------------------------------------------------------------- grants (unchanged model)
revoke execute on function public._delete_history_orders(uuid[], text, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_preview_order_deletion(uuid[]) from public, anon;
revoke execute on function public.admin_delete_order_history(uuid[], text, jsonb) from public, anon;
revoke execute on function public.staff_list_order_history(timestamptz, timestamptz, text, int) from public, anon;
grant execute on function public.admin_preview_order_deletion(uuid[]) to authenticated, service_role;
grant execute on function public.admin_delete_order_history(uuid[], text, jsonb) to authenticated, service_role;
grant execute on function public.staff_list_order_history(timestamptz, timestamptz, text, int) to authenticated, service_role;

notify pgrst, 'reload schema';
