-- Migration 0029: Security hardening (Batch 1)
--
-- 1. Restrict portal_notifications: revoke INSERT/full UPDATE from authenticated,
--    grant column-level UPDATE (is_read, read_at) only, drop staff INSERT policy,
--    add CHECK constraints for link_url pattern and field lengths.
-- 2. Revoke unnecessary anon SELECT on 16 non-public tables.
-- 3. Revoke EXECUTE on trigger functions from PUBLIC/anon/authenticated.
-- 4. Add 1000-char CHECK constraints on unbounded text columns.

BEGIN;

-- ============================================================================
-- 1. portal_notifications permission lockdown
-- ============================================================================

-- Revoke table-wide INSERT and UPDATE from authenticated
REVOKE INSERT ON public.portal_notifications FROM authenticated;
REVOKE UPDATE ON public.portal_notifications FROM authenticated;

-- Grant column-level UPDATE only on is_read and read_at
GRANT UPDATE (is_read, read_at) ON public.portal_notifications TO authenticated;

-- Drop the staff INSERT policy (triggers insert as postgres, not as authenticated)
DROP POLICY IF EXISTS portal_notifications_staff_insert ON public.portal_notifications;

-- link_url must be a same-site staff/admin path
ALTER TABLE public.portal_notifications
  ADD CONSTRAINT chk_portal_notifications_link_url_pattern
  CHECK (link_url ~ '^/(staff|admin)(\?[A-Za-z0-9_=&%.\-]*)?$') NOT VALID;

ALTER TABLE public.portal_notifications
  ADD CONSTRAINT chk_portal_notifications_link_url_length
  CHECK (length(link_url) <= 300) NOT VALID;

ALTER TABLE public.portal_notifications
  ADD CONSTRAINT chk_portal_notifications_title_length
  CHECK (length(title) <= 200) NOT VALID;

ALTER TABLE public.portal_notifications
  ADD CONSTRAINT chk_portal_notifications_message_length
  CHECK (length(message) <= 1000) NOT VALID;

-- Validate the constraints against existing data; raise NOTICE (not ERROR) on failure
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.portal_notifications VALIDATE CONSTRAINT chk_portal_notifications_link_url_pattern;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Existing portal_notifications rows violate link_url pattern constraint. Aborting migration.';
  END;
  BEGIN
    ALTER TABLE public.portal_notifications VALIDATE CONSTRAINT chk_portal_notifications_link_url_length;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Existing portal_notifications rows violate link_url length constraint. Aborting migration.';
  END;
  BEGIN
    ALTER TABLE public.portal_notifications VALIDATE CONSTRAINT chk_portal_notifications_title_length;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Existing portal_notifications rows violate title length constraint. Aborting migration.';
  END;
  BEGIN
    ALTER TABLE public.portal_notifications VALIDATE CONSTRAINT chk_portal_notifications_message_length;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Existing portal_notifications rows violate message length constraint. Aborting migration.';
  END;
END
$$;

-- ============================================================================
-- 2. Revoke unnecessary anon SELECT on non-public tables
-- ============================================================================
-- Keep: categories, products, product_variants, product_images, price_tiers,
--       price_tier_rules, locations, business_hours, special_closures,
--       public_store_status (view)

REVOKE SELECT ON public.audit_logs FROM anon;
REVOKE SELECT ON public.custom_cake_images FROM anon;
REVOKE SELECT ON public.custom_cake_quotes FROM anon;
REVOKE SELECT ON public.custom_cake_requests FROM anon;
REVOKE SELECT ON public.notifications FROM anon;
REVOKE SELECT ON public.order_internal_notes FROM anon;
REVOKE SELECT ON public.order_items FROM anon;
REVOKE SELECT ON public.order_status_history FROM anon;
REVOKE SELECT ON public.order_transitions FROM anon;
REVOKE SELECT ON public.orders FROM anon;
REVOKE SELECT ON public.payments FROM anon;
REVOKE SELECT ON public.portal_notifications FROM anon;
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.request_messages FROM anon;
REVOKE SELECT ON public.staff_roles FROM anon;
REVOKE SELECT ON public.store_settings FROM anon;

-- ============================================================================
-- 3. Revoke EXECUTE on trigger functions
-- ============================================================================
-- Trigger functions are SECURITY DEFINER (owner postgres) so triggers still fire.
-- Precedent: audit_row_change already has EXECUTE revoked.

REVOKE EXECUTE ON FUNCTION public.on_order_created_notification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.on_custom_cake_created_notification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_price_rule_note_change() FROM PUBLIC;

-- ============================================================================
-- 4. Text-length CHECK constraints on unbounded columns (1000 chars)
-- ============================================================================

-- custom_cake_quotes.bakery_note
ALTER TABLE public.custom_cake_quotes
  ADD CONSTRAINT chk_custom_cake_quotes_bakery_note_length
  CHECK (length(bakery_note) <= 1000) NOT VALID;

-- custom_cake_requests.decline_reason
ALTER TABLE public.custom_cake_requests
  ADD CONSTRAINT chk_custom_cake_requests_decline_reason_length
  CHECK (length(decline_reason) <= 1000) NOT VALID;

-- order_status_history.note
ALTER TABLE public.order_status_history
  ADD CONSTRAINT chk_order_status_history_note_length
  CHECK (length(note) <= 1000) NOT VALID;

-- orders.bakery_note
ALTER TABLE public.orders
  ADD CONSTRAINT chk_orders_bakery_note_length
  CHECK (length(bakery_note) <= 1000) NOT VALID;

-- orders.cancellation_reason
ALTER TABLE public.orders
  ADD CONSTRAINT chk_orders_cancellation_reason_length
  CHECK (length(cancellation_reason) <= 1000) NOT VALID;

-- orders.rejection_reason
ALTER TABLE public.orders
  ADD CONSTRAINT chk_orders_rejection_reason_length
  CHECK (length(rejection_reason) <= 1000) NOT VALID;

-- Validate all new constraints; abort on failure
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE conname IN (
      'chk_custom_cake_quotes_bakery_note_length',
      'chk_custom_cake_requests_decline_reason_length',
      'chk_order_status_history_note_length',
      'chk_orders_bakery_note_length',
      'chk_orders_cancellation_reason_length',
      'chk_orders_rejection_reason_length'
    )
    AND NOT convalidated
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'Existing rows in % violate constraint %. Aborting migration.', c.tbl, c.conname;
    END;
  END LOOP;
END
$$;

COMMIT;
