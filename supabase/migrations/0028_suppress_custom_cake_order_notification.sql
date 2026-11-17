-- Migration: 0028_suppress_custom_cake_order_notification.sql
-- Suppress duplicate NEW_ORDER portal notifications for orders converted from custom cake requests (#100)

create or replace function public.on_order_created_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Converted custom cake requests already notified staff via NEW_CUSTOM_CAKE
  if new.custom_request_id is not null then
    return new;
  end if;

  insert into public.portal_notifications (
    type,
    title,
    message,
    link_url,
    related_entity_id
  ) values (
    'NEW_ORDER',
    'New Order Received',
    'Order #' || new.order_number || ' has been received.',
    '/staff?tab=ORDERS&orderId=' || new.id::text,
    new.id::text
  );
  return new;
end;
$$;

