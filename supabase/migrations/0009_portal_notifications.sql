-- Migration: 0009_portal_notifications.sql
-- In-website notifications for Admin and Staff portals

create table if not exists public.portal_notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('NEW_ORDER', 'NEW_CUSTOM_CAKE')),
  title text not null,
  message text not null,
  link_url text not null,
  related_entity_id text,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes for efficient querying & filtering
create index if not exists idx_portal_notifications_created_at
  on public.portal_notifications (created_at desc);

create index if not exists idx_portal_notifications_unread
  on public.portal_notifications (is_read, created_at desc);

-- Enable Row Level Security
alter table public.portal_notifications enable row level security;

-- RLS Policies: only authenticated staff and admin have access
create policy portal_notifications_staff_select
  on public.portal_notifications
  for select
  to authenticated
  using (is_staff());

create policy portal_notifications_staff_update
  on public.portal_notifications
  for update
  to authenticated
  using (is_staff())
  with check (is_staff());

create policy portal_notifications_staff_insert
  on public.portal_notifications
  for insert
  to authenticated
  with check (is_staff());

-- Grant permissions to authenticated users and service_role
grant select, insert, update on table public.portal_notifications to authenticated, service_role;

-- Enable Realtime publication
alter table public.portal_notifications replica identity full;
alter publication supabase_realtime add table public.portal_notifications;

-- Automatic trigger for new orders
create or replace function public.on_order_created_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists trg_order_created_notification on public.orders;
create trigger trg_order_created_notification
after insert on public.orders
for each row
execute function public.on_order_created_notification();

-- Automatic trigger for new custom cake requests
create or replace function public.on_custom_cake_created_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.portal_notifications (
    type,
    title,
    message,
    link_url,
    related_entity_id
  ) values (
    'NEW_CUSTOM_CAKE',
    'New Custom Cake Request',
    'A new custom cake request has been received.',
    '/staff?tab=CUSTOM_CAKES&requestId=' || new.id::text,
    new.id::text
  );
  return new;
end;
$$;

drop trigger if exists trg_custom_cake_created_notification on public.custom_cake_requests;
create trigger trg_custom_cake_created_notification
after insert on public.custom_cake_requests
for each row
execute function public.on_custom_cake_created_notification();

