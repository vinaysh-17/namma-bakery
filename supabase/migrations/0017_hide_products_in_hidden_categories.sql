-- 0017: Hiding or archiving a category also hides and blocks its products (#58).
--
-- RLS hid only the category row. Products in a hidden or archived category were still
-- returned to customers (with a null category), so they appeared on /menu "All Items"
-- and the home page, linked to a 404, and could still be added to the cart and ordered,
-- because place_order never looked at the category.

-- 1. Customers only see products whose category is visible and not archived.
--    Staff still see everything, as before.
drop policy if exists products_read on public.products;
create policy products_read on public.products for select to anon, authenticated
  using (
    is_staff()
    or (
      archived_at is null
      and exists (
        select 1 from public.categories c
         where c.id = products.category_id
           and c.is_visible
           and c.archived_at is null
      )
    )
  );

-- 2. Orders cannot include products from a hidden or archived category, for example
--    items that were already in a customer's cart when the category was hidden.
--    place_order is SECURITY DEFINER and bypasses RLS, so this check sits on the
--    order_items insert itself. Custom cake orders have no product_id and are not affected.
create or replace function public.ensure_order_item_category_visible() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select p.name into v_name
    from products p
    join categories c on c.id = p.category_id
   where p.id = new.product_id
     and (not c.is_visible or c.archived_at is not null);
  if found then
    -- Same error code place_order uses for unavailable products, so the app shows its
    -- existing "currently unavailable" message.
    raise exception 'PRODUCT_UNAVAILABLE: %', v_name using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.ensure_order_item_category_visible() from public;

drop trigger if exists trg_order_item_category_visible on public.order_items;
create trigger trg_order_item_category_visible
  before insert on public.order_items
  for each row
  when (new.product_id is not null)
  execute function public.ensure_order_item_category_visible();
