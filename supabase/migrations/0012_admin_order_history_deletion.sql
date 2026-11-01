-- Migration: 0012_admin_order_history_deletion.sql
--
-- Admin-only deletion of ORDER HISTORY + automatic 3-month retention cleanup.
--
-- What is "history":
--   Orders in a terminal state: COMPLETED, REJECTED, CANCELLED, NO_SHOW.
--   PENDING / ACCEPTED / PREPARING / READY_FOR_PICKUP are active and are NEVER deletable.
--   Orders created from a custom cake request (orders.custom_request_id is not null) are also
--   never deleted here: the request would otherwise lose its linked order and fall back to
--   the legacy "accepted" stage in the staff queue. The custom cake workflow is untouched.
--
-- Timestamp used everywhere (day / week / month filters AND the retention cutoff):
--   orders.created_at  (the date the order was placed - the same date the staff queue uses).
--
-- What is deleted together with an order (verified against 0001_schema.sql):
--   * order_items, order_status_history, order_internal_notes, notifications
--       -> already ON DELETE CASCADE from orders.
--   * payments -> order_id references orders(id) WITHOUT cascade, so they are deleted
--       explicitly in the same transaction (they belong to the order; a summary - count and
--       totals - is kept in the audit log).
--   * Retained: customers/profiles, custom cake requests, products, audit_logs (no FK).
--
-- Security:
--   * admin_* functions re-check is_admin() INSIDE the database (not just in the app).
--   * Staff, anon and unauthenticated callers get a 42501 forbidden error.
--   * purge_old_order_history() and the internal helper are NOT executable by browser roles.
--   * Every delete is one transaction (a function call) and writes an audit_logs row first.

-- ---------------------------------------------------------------- internal delete helper
create or replace function public._delete_history_orders(p_ids uuid[], p_method text, p_detail jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ids      uuid[];
  v_bad      text[];
  v_count    int;
  v_total    bigint;
  v_numbers  text[];
  v_pay_n    int;
  v_pay_sum  bigint;
begin
  select coalesce(array_agg(distinct i), '{}') into v_ids from unnest(coalesce(p_ids, '{}')) as i;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('deleted', 0, 'order_numbers', '[]'::jsonb, 'total_paise', 0);
  end if;

  -- lock the rows so their status cannot change between the check and the delete
  perform 1 from orders where id = any(v_ids) for update;

  -- ANY requested order that is missing / active / custom-cake linked aborts the whole delete
  select array_agg(coalesce(o.order_number, i::text)) into v_bad
    from unnest(v_ids) as i
    left join orders o on o.id = i
   where o.id is null
      or o.status not in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW')
      or o.custom_request_id is not null;
  if v_bad is not null then
    raise exception 'ORDERS_NOT_ELIGIBLE: %', array_to_string(v_bad, ', ') using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(total_paise), 0), array_agg(order_number order by order_number)
    into v_count, v_total, v_numbers
    from orders where id = any(v_ids);
  select count(*), coalesce(sum(amount_paise), 0) into v_pay_n, v_pay_sum
    from payments where order_id = any(v_ids);

  -- audit FIRST (audit_logs has no FK to orders, so it survives the deletion)
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after_data)
  values (auth.uid(), current_actor_role(), 'order_history.deleted', 'orders', null,
          jsonb_build_object(
            'method', p_method,
            'count', v_count,
            'order_numbers', to_jsonb(v_numbers[1:500]),
            'total_paise', v_total,
            'payments_removed', v_pay_n,
            'payments_paise', v_pay_sum
          ) || coalesce(p_detail, '{}'::jsonb));

  delete from payments where order_id = any(v_ids);
  delete from orders   where id = any(v_ids);   -- items / status history / notes / notifications cascade

  return jsonb_build_object('deleted', v_count, 'order_numbers', to_jsonb(v_numbers), 'total_paise', v_total);
end $$;

-- ---------------------------------------------------------------- admin: list history orders
create or replace function public.admin_list_order_history(p_from timestamptz, p_to timestamptz, p_limit int default 300)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 300), 1), 500);
  v_total int;
  v_custom int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  select count(*) into v_total from orders
   where status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW') and custom_request_id is null
     and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to);
  select count(*) into v_custom from orders
   where status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW') and custom_request_id is not null
     and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to);

  return jsonb_build_object(
    'total', v_total,
    'excluded_custom', v_custom,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'order_number', o.order_number, 'status', o.status,
               'created_at', o.created_at, 'total_paise', o.total_paise,
               'payment_status', o.payment_status) order by o.created_at desc)
        from (
          select * from orders
           where status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW') and custom_request_id is null
             and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
           order by created_at desc
           limit v_limit
        ) o
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- admin: preview a deletion
-- Reads the CURRENT database state for exactly the orders the admin is about to delete.
create or replace function public.admin_preview_order_deletion(p_order_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if cardinality(coalesce(p_order_ids, '{}')) > 1000 then raise exception 'TOO_MANY_ORDERS' using errcode = 'P0001'; end if;

  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'order_number', o.order_number, 'status', o.status,
               'created_at', o.created_at, 'total_paise', o.total_paise,
               'eligible', (o.status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW') and o.custom_request_id is null)
             ) order by o.created_at desc)
        from orders o where o.id = any(p_order_ids)
    ), '[]'::jsonb),
    'missing', (select count(*) from unnest(p_order_ids) i where not exists (select 1 from orders o where o.id = i))
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

-- ---------------------------------------------------------------- automatic retention
-- Deletes terminal history orders older than p_months (default 3) by created_at.
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

  select coalesce(array_agg(id), '{}') into v_ids from orders
   where status in ('COMPLETED','REJECTED','CANCELLED','NO_SHOW')
     and custom_request_id is null
     and created_at < v_cutoff;

  if cardinality(v_ids) = 0 then return 0; end if;

  v_res := _delete_history_orders(v_ids, 'retention_cleanup',
             jsonb_build_object('retention_months', p_months, 'cutoff', v_cutoff));
  return (v_res->>'deleted')::int;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public._delete_history_orders(uuid[], text, jsonb) from public, anon, authenticated;
revoke execute on function public.purge_old_order_history(int) from public, anon, authenticated;
revoke execute on function public.admin_list_order_history(timestamptz, timestamptz, int) from public, anon;
revoke execute on function public.admin_preview_order_deletion(uuid[]) from public, anon;
revoke execute on function public.admin_delete_order_history(uuid[], text, jsonb) from public, anon;

grant execute on function public.purge_old_order_history(int) to service_role;
-- authenticated may call the admin_* functions, but each one rejects non-admins inside the database
grant execute on function public.admin_list_order_history(timestamptz, timestamptz, int) to authenticated, service_role;
grant execute on function public.admin_preview_order_deletion(uuid[]) to authenticated, service_role;
grant execute on function public.admin_delete_order_history(uuid[], text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- schedule (pg_cron, if available)
-- Runs daily at 21:30 UTC (03:00 IST). If the pg_cron extension is not available in this
-- project the block only prints a notice - enable pg_cron (Dashboard -> Database -> Extensions)
-- and re-run this block, or call:  select public.purge_old_order_history();
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-old-order-history', '30 21 * * *', 'select public.purge_old_order_history(3)');
  else
    raise notice 'pg_cron is not available; order history retention is NOT scheduled.';
  end if;
exception when others then
  raise notice 'Could not schedule order history retention: %', sqlerrm;
end $$;
