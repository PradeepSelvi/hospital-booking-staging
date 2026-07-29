-- ═══════════════════════════════════════════════════════════════
-- APPOINTMENT PAYMENTS  (Razorpay online + offline/cash)
--
-- Flow:
--   1. At consultation close the doctor sets the amount due
--      → request_appointment_payment() creates a PENDING payment.
--      The appointment is NOT marked COMPLETED yet.
--   2. The patient pays:
--      • ONLINE  → Razorpay checkout; the `razorpay-verify-payment` edge
--        function (service role) verifies the signature, marks the payment
--        PAID and completes the appointment.
--      • OFFLINE → pay_appointment_offline() records a cash payment, marks it
--        PAID and completes the appointment.
--   3. A receipt number is generated on payment.
--
-- The appointment only reaches COMPLETED once its payment is PAID.
--
-- Depends on: 001 (appointments, doctors, profiles), 018 (appointments.completed_at).
-- Idempotent / safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. PAYMENTS TABLE  (one per appointment)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id      BIGINT NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
    patient_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id           BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    amount_paise        BIGINT NOT NULL CHECK (amount_paise >= 100),   -- Razorpay min = 100 paise
    currency            TEXT NOT NULL DEFAULT 'INR',
    method              TEXT CHECK (method IN ('ONLINE', 'OFFLINE')),
    status              TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature  TEXT,
    receipt_number      TEXT UNIQUE,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at             TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_patient ON public.payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_payments_doctor ON public.payments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);

DROP TRIGGER IF EXISTS set_payments_updated_at ON public.payments;
CREATE TRIGGER set_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────
-- 2. RLS — read-only for participants; all writes happen via the
--    SECURITY DEFINER functions below or the service-role edge function.
-- ─────────────────────────────────────────────
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_patient_read" ON public.payments;
CREATE POLICY "payments_patient_read" ON public.payments
    FOR SELECT USING (patient_id = auth.uid());

DROP POLICY IF EXISTS "payments_doctor_read" ON public.payments;
CREATE POLICY "payments_doctor_read" ON public.payments
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = doctor_id AND d.user_id = auth.uid())
    );

DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;
CREATE POLICY "payments_admin_all" ON public.payments
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
    );

-- ─────────────────────────────────────────────
-- 3. Receipt number helper: RCPT-<YYYY>-<zero-padded payment id>
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_receipt_number(p_id BIGINT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT 'RCPT-' || to_char(NOW(), 'YYYY') || '-' || lpad(p_id::TEXT, 6, '0');
$$;

-- ─────────────────────────────────────────────
-- 4. DOCTOR: request payment at consultation close.
--    Creates/updates a PENDING payment with the amount due. Does NOT complete
--    the appointment — that happens only once the payment is PAID.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_appointment_payment(
    p_appointment_id BIGINT,
    p_amount_paise   BIGINT
)
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_apt     public.appointments;
    v_doctor  BIGINT;
    v_payment public.payments;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;
    IF p_amount_paise < 100 THEN
        RAISE EXCEPTION 'Amount must be at least ₹1 (100 paise).' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_apt FROM public.appointments WHERE id = p_appointment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Appointment not found.' USING ERRCODE = 'P0001';
    END IF;

    -- Caller must be the doctor who owns this appointment.
    SELECT id INTO v_doctor FROM public.doctors WHERE id = v_apt.doctor_id AND user_id = auth.uid();
    IF v_doctor IS NULL THEN
        RAISE EXCEPTION 'Only the assigned doctor can request payment.' USING ERRCODE = '42501';
    END IF;

    IF v_apt.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Cannot request payment for a cancelled appointment.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.payments (appointment_id, patient_id, doctor_id, amount_paise, status)
    VALUES (p_appointment_id, v_apt.patient_id, v_apt.doctor_id, p_amount_paise, 'PENDING')
    ON CONFLICT (appointment_id) DO UPDATE
        SET amount_paise = EXCLUDED.amount_paise,
            status = CASE WHEN public.payments.status = 'PAID' THEN 'PAID' ELSE 'PENDING' END,
            updated_at = NOW()
    RETURNING * INTO v_payment;

    RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.request_appointment_payment(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_appointment_payment(BIGINT, BIGINT) TO authenticated;

-- ─────────────────────────────────────────────
-- 5. PATIENT: pay offline (cash at clinic).
--    Marks the payment PAID/OFFLINE, generates a receipt, completes the visit.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pay_appointment_offline(p_appointment_id BIGINT)
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_payment public.payments;
BEGIN
    SELECT * INTO v_payment FROM public.payments WHERE appointment_id = p_appointment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No payment request found for this appointment.' USING ERRCODE = 'P0001';
    END IF;

    -- Only the paying patient may confirm their own offline payment.
    IF v_payment.patient_id <> auth.uid() THEN
        RAISE EXCEPTION 'You can only pay for your own appointment.' USING ERRCODE = '42501';
    END IF;

    IF v_payment.status = 'PAID' THEN
        RETURN v_payment;  -- already settled
    END IF;

    UPDATE public.payments
       SET method = 'OFFLINE',
           status = 'PAID',
           paid_at = NOW(),
           receipt_number = COALESCE(receipt_number, public.build_receipt_number(id))
     WHERE id = v_payment.id
    RETURNING * INTO v_payment;

    UPDATE public.appointments
       SET status = 'COMPLETED', completed_at = NOW()
     WHERE id = p_appointment_id AND status <> 'CANCELLED';

    RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_appointment_offline(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_appointment_offline(BIGINT) TO authenticated;

-- ─────────────────────────────────────────────
-- 6. SERVICE ROLE: mark an online payment PAID after signature verification.
--    Callable ONLY by the razorpay-verify-payment edge function (service role).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_payment_paid_online(
    p_order_id   TEXT,
    p_payment_id TEXT,
    p_signature  TEXT
)
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_payment public.payments;
BEGIN
    SELECT * INTO v_payment FROM public.payments WHERE razorpay_order_id = p_order_id;
    IF NOT FOUND THEN
        -- Unknown order (e.g. a webhook for something we don't track): no-op.
        RETURN NULL;
    END IF;

    UPDATE public.payments
       SET method = 'ONLINE',
           status = 'PAID',
           razorpay_payment_id = p_payment_id,
           razorpay_signature = p_signature,
           paid_at = NOW(),
           receipt_number = COALESCE(receipt_number, public.build_receipt_number(id))
     WHERE id = v_payment.id
    RETURNING * INTO v_payment;

    UPDATE public.appointments
       SET status = 'COMPLETED', completed_at = NOW()
     WHERE id = v_payment.appointment_id AND status <> 'CANCELLED';

    RETURN v_payment;
END;
$$;

-- Lock this down to the service role only (edge function). No client may call it.
REVOKE ALL ON FUNCTION public.mark_payment_paid_online(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_payment_paid_online(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payment_paid_online(TEXT, TEXT, TEXT) TO service_role;
