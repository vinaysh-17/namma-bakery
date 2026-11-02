-- 0018: Let employees cancel orders (#60).
--
-- transition_order stored current_actor_role() in orders.cancelled_by. For employees that
-- is 'EMPLOYEE', which the check constraint (cancelled_by in ('CUSTOMER','STAFF','ADMIN'))
-- rejects, so every employee cancellation failed with a constraint violation, even though
-- order_transitions allows employees to cancel PENDING and ACCEPTED orders.
--
-- The function below is unchanged from 0002 except for the cancelled_by assignment:
-- admins are recorded as 'ADMIN' and every other staff member as 'STAFF'.
-- order_status_history.actor_role and audit_logs.actor_role still record the exact role.
-- create or replace keeps the existing grants.

create or replace function public.transition_order(p_order_id uuid, p_to order_status, p_note text default null, p_estimated_ready_at timestamptz default null)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders; t order_transitions; v_admin boolean := is_admin(); v_role text := current_actor_role(); v_from order_status; v_override boolean := false;
begin
  if not is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  v_from := o.status;

  select * into t from order_transitions where from_status = o.status and to_status = p_to;
  if not found then
    if not v_admin or nullif(trim(coalesce(p_note,'')), '') is null then
      raise exception 'INVALID_TRANSITION: % -> %', o.status, p_to using errcode = 'P0001';
    end if;                                   -- admin override: requires a reason
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
    -- orders.cancelled_by only allows CUSTOMER/STAFF/ADMIN, but current_actor_role() returns
    -- the app_role value ('EMPLOYEE' or 'ADMIN'). Writing 'EMPLOYEE' broke the check constraint.
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
