-- Migration: 0015_custom_cake_retention_cleanup.sql
--
-- Extends the automatic 3-month Order History cleanup (purge_old_order_history, scheduled daily at
-- 03:00 IST by the existing pg_cron job 'purge-old-order-history' from 0012) so it also removes
-- eligible historical CUSTOM CAKE orders. The cron job is NOT touched or duplicated: it calls
-- purge_old_order_history(3) by name, and this migration only replaces that function's body.
-- Requires 0012, 0013 and 0014 to be applied first. Safe to re-run (create ... if not exists /
-- create or replace; no existing data is modified).
--
-- How the cleanup works (one transaction per run - all or nothing):
--   Regular orders ....... terminal (COMPLETED/REJECTED/CANCELLED/NO_SHOW), not linked to a custom
--                          cake, created_at older than the cutoff.
--   Custom cake WITH order  the request's linked order is terminal and the order's created_at is older
--                          than the cutoff -> the linked NB order AND the CC request are deleted together.
--   Custom cake WITHOUT order  request ended (DECLINED/CUSTOMER_DECLINED/EXPIRED/WITHDRAWN) and the
--                          request's created_at is older than the cutoff -> the CC request is deleted.
--   Active records ....... never selected (and _delete_history_orders re-checks every id and aborts
--                          the whole run if any id is not eligible history).
--   Kept ................. customers/profiles, products, audit_logs (the run writes an audit row).
--   Reference photos ..... their storage paths are queued in storage_cleanup_queue in the same
--                          transaction; the server (admin portal) removes the files from the private
--                          'cake-references' bucket and then clears the queue. SQL cannot delete
--                          storage objects (Supabase blocks direct deletes on storage tables).

create table if not exists public.storage_cleanup_queue (
  id         bigint generated always as identity primary key,
  bucket     text not null default 'cake-references',
  path       text not null,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);
alter table public.storage_cleanup_queue enable row level security;   -- no policies: nobody but the owner
revoke all on public.storage_cleanup_queue from public, anon, authenticated;
grant select, delete on public.storage_cleanup_queue to service_role;

-- ---------------------------------------------------------------- internal delete helper
-- Identical to 0014 except that reference photo paths are queued for storage cleanup.
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

  -- Reference photos are files in the private storage bucket; SQL (and pg_cron) cannot delete
  -- them. Queue their paths in the same transaction - they are removed by the server job.
  insert into storage_cleanup_queue (bucket, path)
  select 'cake-references', p from unnest(v_paths) as p
  on conflict do nothing;

  delete from payments where order_id = any(v_all_ord);
  delete from orders   where id = any(v_all_ord);                -- items / history / notes / notifications cascade
  delete from custom_cake_requests where id = any(v_req);        -- images / quotes / messages / notifications cascade

  return jsonb_build_object('deleted', v_reg_n + v_req_n, 'order_numbers', to_jsonb(v_numbers),
                            'total_paise', v_total, 'storage_paths', to_jsonb(v_paths));
end $$;

-- ---------------------------------------------------------------- automatic retention
-- Deletes terminal history (regular orders AND custom cakes) older than p_months by created_at,
-- using the same helper (and therefore the same safety checks) as the manual admin deletion.
-- Server/database only: executable by service_role (and by pg_cron, which runs as the owner).
create or replace function public.purge_old_order_history(p_months int default 3)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz;
  v_ids    uuid[];
  v_res    jsonb;
begin
  if p_months is null or p_months < 1 then raise exception 'INVALID_RETENTION' using errcode = 'P0001'; end if;
  v_cutoff := now() - make_interval(months => p_months);

  select coalesce(array_agg(id), '{}') into v_ids from (
    -- regular orders
    select o.id from orders o
     where o.status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW')
       and o.custom_request_id is null
       and o.created_at < v_cutoff
    union all
    -- custom cake history records (identified by their REQUEST id; the linked order goes with it)
    select r.id from custom_cake_requests r
      left join orders lo on lo.custom_request_id = r.id
     where ((lo.id is not null and lo.status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW'))
         or (lo.id is null and r.status in ('DECLINED','CUSTOMER_DECLINED','EXPIRED','WITHDRAWN')))
       and coalesce(lo.created_at, r.created_at) < v_cutoff
  ) x;

  if cardinality(v_ids) = 0 then return 0; end if;

  v_res := _delete_history_orders(v_ids, 'retention_cleanup',
             jsonb_build_object('retention_months', p_months, 'cutoff', v_cutoff));
  return (v_res->>'deleted')::int;
end $$;

revoke execute on function public._delete_history_orders(uuid[], text, jsonb) from public, anon, authenticated;
revoke execute on function public.purge_old_order_history(int) from public, anon, authenticated;
grant execute on function public.purge_old_order_history(int) to service_role;

notify pgrst, 'reload schema';
