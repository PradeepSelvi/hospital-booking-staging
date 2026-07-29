-- ═══════════════════════════════════════════════════════════════
-- ADMIN PAYMENT MANAGEMENT  (secure track + manage)
--
-- Goal: let ADMINS view/track every payment and perform a small, safe set of
-- management actions — WITHOUT giving them a way to fabricate money.
--
-- Security model:
--   • Admin gets READ-ONLY table access. The previous `payments_admin_all
--     FOR ALL` policy let an admin (or a compromised admin browser session)
--     directly UPDATE a row to status='PAID' / change amount_paise with the
--     public anon key — i.e. mint a paid appointment with no Razorpay proof.
--     We replace it with SELECT-only.
--   • All state changes happen ONLY through SECURITY DEFINER RPCs that:
--       - verify the caller is an admin (server-side, recursion-safe is_admin())
--       - allow only legitimate transitions:
--           PENDING → FAILED   (abandon a stuck request)
--           PAID    → REFUNDED (record a refund)
--         Admins can NEVER set PAID — that stays exclusive to the Razorpay
--         verify/webhook path and the patient offline-cash RPC.
--       - record who/when/why on the row (immutable-ish audit trail).
--
-- Idempotent / safe to re-run. Depends on: 022 (payments), 024 (is_admin()).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Extend status set + add admin audit columns
-- ─────────────────────────────────────────────
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments
    ADD CONSTRAINT payments_status_check
    CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED'));

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS admin_note   TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS actioned_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS actioned_at  TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refunded_at  TIMESTAMPTZ;

-- ─────────────────────────────────────────────
-- 2. RLS: admin is READ-ONLY (no direct writes from the client)
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_read" ON public.payments;
CREATE POLICY "payments_admin_read" ON public.payments
    FOR SELECT USING (public.is_admin());

-- (patient/doctor SELECT policies from 022 remain unchanged.)

-- ─────────────────────────────────────────────
-- 3. Aggregate stats for the admin panel (server-side; no row dump)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_payment_stats()
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v JSON;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can view payment statistics.' USING ERRCODE = '42501';
    END IF;

    SELECT json_build_object(
        'total_count',       COUNT(*),
        'paid_count',        COUNT(*) FILTER (WHERE status = 'PAID'),
        'pending_count',     COUNT(*) FILTER (WHERE status = 'PENDING'),
        'failed_count',      COUNT(*) FILTER (WHERE status = 'FAILED'),
        'refunded_count',    COUNT(*) FILTER (WHERE status = 'REFUNDED'),
        'collected_paise',   COALESCE(SUM(amount_paise) FILTER (WHERE status = 'PAID'), 0),
        'pending_paise',     COALESCE(SUM(amount_paise) FILTER (WHERE status = 'PENDING'), 0),
        'refunded_paise',    COALESCE(SUM(amount_paise) FILTER (WHERE status = 'REFUNDED'), 0),
        'online_count',      COUNT(*) FILTER (WHERE status = 'PAID' AND method = 'ONLINE'),
        'offline_count',     COUNT(*) FILTER (WHERE status = 'PAID' AND method = 'OFFLINE')
    ) INTO v
    FROM public.payments;

    RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_payment_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_payment_stats() TO authenticated;

-- ─────────────────────────────────────────────
-- 4. ADMIN: mark a stuck PENDING payment as FAILED
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_fail_payment(
    p_payment_id BIGINT,
    p_reason     TEXT
)
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_payment public.payments;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can manage payments.' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN
        RAISE EXCEPTION 'A reason is required.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0001';
    END IF;
    IF v_payment.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Only a PENDING payment can be marked FAILED (current: %).', v_payment.status
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.payments
       SET status      = 'FAILED',
           admin_note  = left(p_reason, 500),
           actioned_by = auth.uid(),
           actioned_at = NOW()
     WHERE id = p_payment_id
    RETURNING * INTO v_payment;

    RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_fail_payment(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_fail_payment(BIGINT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────
-- 5. ADMIN: record a REFUND against a PAID payment
--    (records the refund; the actual money-move is done in the Razorpay
--     dashboard / API — this is the reconciliation record.)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_refund_payment(
    p_payment_id BIGINT,
    p_reason     TEXT
)
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_payment public.payments;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can manage payments.' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN
        RAISE EXCEPTION 'A refund reason is required.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0001';
    END IF;
    IF v_payment.status <> 'PAID' THEN
        RAISE EXCEPTION 'Only a PAID payment can be refunded (current: %).', v_payment.status
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.payments
       SET status      = 'REFUNDED',
           admin_note  = left(p_reason, 500),
           actioned_by = auth.uid(),
           actioned_at = NOW(),
           refunded_at = NOW()
     WHERE id = p_payment_id
    RETURNING * INTO v_payment;

    RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_refund_payment(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_refund_payment(BIGINT, TEXT) TO authenticated;
