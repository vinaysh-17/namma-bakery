-- Migration: 0022_transition_order_stale_state.sql
--
-- GitHub issue #79: "Admin acting on an out-of-date screen silently triggers an admin override
-- and can cancel an already-completed order".
--
-- The bug: transition_order lets an ADMIN make ANY move (not in order_transitions) when a note
-- is given - an "admin override". Reject / Cancel always send a note, and the caller never said
-- which status the screen was showing. So an admin who opened Cancel on an order shown as
-- ACCEPTED, while an employee completed it and took payment, silently overrode
-- COMPLETED -> CANCELLED and left the order marked as paid.
--
-- The fix (the database is the final authority, not React):
--  1. Optimistic concurrency. transition_order takes p_expected_from - the status the caller's
--     screen believes the order has. After the row is locked it is compared with the real status;
--     any difference raises STALE_STATE and NOTHING is changed. This check runs before the
--     transition lookup, so it also covers the admin-override path.
--  2. An override can never run blind: an override (a move that is not in order_transitions)
--     now REQUIRES p_expected_from (EXPECTED_STATUS_REQUIRED otherwise).
--  3. Policy (explained, not a new workflow - there is no refund/reopen workflow in the app):
--       * a COMPLETED order is final: no override, ORDER_FINAL.
--       * an order that has been PAID cannot be moved to CANCELLED / REJECTED by an override:
--         cancelling is not a refund, and paid + cancelled would be an inconsistent state
--         (PAID_ORDER_CANNOT_BE_CANCELLED).
--     The normal transitions in order_transitions (including the employee ones) and the
--     admin_only flag are unchanged, and legitimate admin overrides on non-final, unpaid
--     orders (with a reason and a matching expected status) still work.
--
-- Backward compatible: p_expected_from defaults to NULL, so existing 4-argument calls behave as
-- before for NORMAL transitions. The old 4-argument function is dropped and recreated with the
-- extra parameter (a second overload would make calls ambiguous); grants are re-applied exactly
-- as in 0003 (authenticated + service_role; the function itself checks is_staff()).
-- The body is otherwise identical to 0018. Re-runnable; no data is modified.

drop function if exists public.transition_order(uuid, order_status, text, timestamptz);

create or replace function public.transition_order(
  p_order_id uuid, p_to order_status, p_note text default null,
  p_estimated_ready_at timestamptz default null, p_expected_from order_status default null)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders; t order_transitions; v_admin boolean := is_admin(); v_role text := current_actor_role(); v_from order_status; v_override boolean := false;
begin
  if not is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  v_from := o.status;

  -- Optimistic concurrency: the screen acted on a status that is no longer true.
  if p_expected_from is not null and p_expected_from <> o.status then
    raise exception 'STALE_STATE: expected %, actual %', p_expected_from, o.status using errcode = 'P0001';
  end if;

  select * into t from order_transitions where from_status = o.status and to_status = p_to;
  if not found then
    if not v_admin or nullif(trim(coalesce(p_note,'')), '') is null then
      raise exception 'INVALID_TRANSITION: % -> %', o.status, p_to using errcode = 'P0001';
    end if;                                   -- admin override: requires a reason
    -- an override may never run blind, never reopen a completed order, never cancel a paid one
    if p_expected_from is null then
      raise exception 'EXPECTED_STATUS_REQUIRED' using errcode = 'P0001';
    end if;
    if o.status = 'COMPLETED' then
      raise exception 'ORDER_FINAL' using errcode = 'P0001';
    end if;
    if o.payment_status = 'paid' and p_to in ('CANCELLED','REJECTED') then
      raise exception 'PAID_ORDER_CANNOT_BE_CANCELLED' using errcode = 'P0001';
    end if;
    v_override := true;
  elsif t.admin_only and not v_admin then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  if p_to in ('REJECTED','CANCELLED') and nullif(trim(coalesce(p_note,'')), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_to = 'ACCEPTED' and coalesce(p_estimated_ready_at, o.estimated_ready_at) is null then
    raise exception 'ESTIMATED_READY_TIME_REQUIRED' using errcode = 'P0001';
  end if;

  update orders set
    status = p_to,
    estimated_ready_at  = coalesce(p_estimated_ready_at, estimated_ready_at),
    confirmed_pickup_at = case when p_to = 'ACCEPTED' then coalesce(confirmed_pickup_at, requested_pickup_at) else confirmed_pickup_at end,
    rejection_reason    = case when p_to = 'REJECTED'  then p_note else rejection_reason end,
    cancellation_reason = case when p_to = 'CANCELLED' then p_note else cancellation_reason end,
    cancelled_by        = case when p_to = 'CANCELLED' then (case when v_admin then 'ADMIN' else 'STAFF' end) else cancelled_by end,
    completed_at        = case when p_to = 'COMPLETED' then now() else completed_at end
  where id = o.id returning * into o;

  insert into order_status_history (order_id, from_status, to_status, changed_by, actor_role, note)
  values (o.id, v_from, p_to, auth.uid(), v_role, p_note);

  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after_data)
  values (auth.uid(), v_role, 'order.status_changed', 'orders', o.id::text,
          jsonb_build_object('order_number', o.order_number, 'to', p_to, 'note', p_note, 'from', v_from, 'override', v_override));
  return o;
end $$;

revoke execute on function public.transition_order(uuid, order_status, text, timestamptz, order_status) from public, anon;
grant execute on function public.transition_order(uuid, order_status, text, timestamptz, order_status) to authenticated, service_role;

notify pgrst, 'reload schema';
