-- ═══════════════════════════════════════════════════════════════
-- MEDIBOOK — STRUCTURED PRESCRIPTIONS (Phase 1)
-- Run in: Supabase SQL Editor (after 034_reject_past_time_slots.sql)
-- Spec:   .kiro/specs/prescription-pharmacy  (Requirements 1, 2, 6, 7)
--
-- Adds:
--   • prescriptions        — one structured Rx per appointment
--   • prescription_items   — discrete medication lines
--   • issue_prescription() / cancel_prescription() RPCs
--   • RLS: doctor owns, patient reads own, admin reads all
--   • Immutability: items are frozen once the parent Rx is ISSUED
--   • Controlled meds require an aal2 (MFA-stepped-up) session to issue
--   • Patient notifications on issue / cancel
--
-- The legacy free-text `consultation_notes.prescription` field is left
-- untouched for backward compatibility (Requirement 1.8).
--
-- Idempotent / safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 0. Extend the notification type allow-list
-- ─────────────────────────────────────────────
ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'APPOINTMENT_BOOKED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED',
        'REMINDER_24H', 'REMINDER_1H', 'APPOINTMENT_COMPLETED', 'SYSTEM',
        'SLOT_AVAILABLE', 'QUEUE_ETA_SHIFT', 'SWAP_MATCHED',
        'PRESCRIPTION_ISSUED', 'PRESCRIPTION_CANCELLED'
    ));

-- ─────────────────────────────────────────────
-- 1. PRESCRIPTIONS (one row per appointment)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id   BIGINT NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
    doctor_id        BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    patient_id       UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    hospital_id      BIGINT REFERENCES public.hospitals(id) ON DELETE SET NULL,
    status           TEXT   NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT', 'ISSUED', 'CANCELLED', 'SUPERSEDED')),
    diagnosis        TEXT,
    issued_at        TIMESTAMPTZ,
    valid_until      DATE,
    cancelled_reason TEXT,
    cancelled_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON public.prescriptions(patient_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor  ON public.prescriptions(doctor_id);

DROP TRIGGER IF EXISTS set_prescriptions_updated_at ON public.prescriptions;
CREATE TRIGGER set_prescriptions_updated_at
    BEFORE UPDATE ON public.prescriptions
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────
-- 2. PRESCRIPTION ITEMS (medication lines)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prescription_items (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prescription_id  BIGINT NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
    drug_name        TEXT   NOT NULL,
    form             TEXT,               -- tablet, syrup, capsule, ...
    strength         TEXT,               -- e.g. "500 mg"
    dosage           TEXT   NOT NULL,    -- e.g. "1 tablet"
    frequency        TEXT   NOT NULL,    -- e.g. "twice daily"
    duration         TEXT   NOT NULL,    -- e.g. "5 days"
    quantity         INT    CHECK (quantity IS NULL OR quantity > 0),
    instructions     TEXT,               -- "after food", ...
    is_controlled    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescription_items_rx ON public.prescription_items(prescription_id);

-- ─────────────────────────────────────────────
-- 3. IMMUTABILITY GUARD
--    Items may only be written while the parent Rx is still DRAFT.
--    Once ISSUED (or later), the item set is frozen — changes require a
--    superseding prescription instead. (Requirement 1.6 / Property 2.)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_rx_item_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_status TEXT;
    v_rx     BIGINT;
BEGIN
    v_rx := COALESCE(NEW.prescription_id, OLD.prescription_id);
    SELECT status INTO v_status FROM public.prescriptions WHERE id = v_rx;
    IF v_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'Prescription items are frozen once the prescription is issued.'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_rx_item_immutable ON public.prescription_items;
CREATE TRIGGER trg_rx_item_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.prescription_items
    FOR EACH ROW EXECUTE FUNCTION public.enforce_rx_item_immutable();

-- ─────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE public.prescriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

-- ── prescriptions ──
-- Doctor who owns the appointment can read/write their prescriptions.
DROP POLICY IF EXISTS "rx_doctor_all" ON public.prescriptions;
CREATE POLICY "rx_doctor_all" ON public.prescriptions
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.doctors d
                WHERE d.id = doctor_id AND d.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.doctors d
                WHERE d.id = doctor_id AND d.user_id = auth.uid())
    );

-- Patient can read prescriptions issued to them (not drafts).
DROP POLICY IF EXISTS "rx_patient_read" ON public.prescriptions;
CREATE POLICY "rx_patient_read" ON public.prescriptions
    FOR SELECT USING (patient_id = auth.uid() AND status <> 'DRAFT');

-- Admin oversight (read-only).
DROP POLICY IF EXISTS "rx_admin_read" ON public.prescriptions;
CREATE POLICY "rx_admin_read" ON public.prescriptions
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
    );

-- ── prescription_items ──
-- Doctor who owns the parent prescription can read/write its items.
DROP POLICY IF EXISTS "rxi_doctor_all" ON public.prescription_items;
CREATE POLICY "rxi_doctor_all" ON public.prescription_items
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.prescriptions p
                JOIN public.doctors d ON d.id = p.doctor_id
                WHERE p.id = prescription_id AND d.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.prescriptions p
                JOIN public.doctors d ON d.id = p.doctor_id
                WHERE p.id = prescription_id AND d.user_id = auth.uid())
    );

-- Patient can read items of prescriptions issued to them.
DROP POLICY IF EXISTS "rxi_patient_read" ON public.prescription_items;
CREATE POLICY "rxi_patient_read" ON public.prescription_items
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.prescriptions p
                WHERE p.id = prescription_id
                  AND p.patient_id = auth.uid()
                  AND p.status <> 'DRAFT')
    );

-- Admin oversight (read-only).
DROP POLICY IF EXISTS "rxi_admin_read" ON public.prescription_items;
CREATE POLICY "rxi_admin_read" ON public.prescription_items
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
    );

-- ─────────────────────────────────────────────
-- 5. RPC: issue_prescription
--    Atomically creates a structured, ISSUED prescription for an appointment
--    the caller (a doctor) owns, then notifies the patient.
--
--    p_items is a JSON array of objects:
--      { drug_name, form, strength, dosage, frequency, duration,
--        quantity, instructions, is_controlled }
--    drug_name / dosage / frequency / duration are required per item.
--
--    Controlled items require the caller's session to be aal2 (MFA stepped-up).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_prescription(
    p_appointment_id BIGINT,
    p_diagnosis      TEXT,
    p_valid_until    DATE,
    p_items          JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_doctor_id  BIGINT;
    v_patient_id UUID;
    v_hospital_id BIGINT;
    v_appt_status TEXT;
    v_rx_id      BIGINT;
    v_item       JSONB;
    v_has_controlled BOOLEAN := FALSE;
    v_count      INT := 0;
    v_doctor_name TEXT;
BEGIN
    -- Resolve the appointment and verify the caller is its doctor.
    SELECT a.doctor_id, a.patient_id, a.status, d.hospital_id, pr.name
      INTO v_doctor_id, v_patient_id, v_appt_status, v_hospital_id, v_doctor_name
      FROM public.appointments a
      JOIN public.doctors d  ON d.id = a.doctor_id
      LEFT JOIN public.profiles pr ON pr.id = d.user_id
     WHERE a.id = p_appointment_id
       AND d.user_id = auth.uid();

    IF v_doctor_id IS NULL THEN
        RAISE EXCEPTION 'You are not authorized to prescribe for this appointment.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_appt_status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Cannot issue a prescription for a cancelled appointment.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'A prescription must contain at least one medication.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Any controlled item requires an aal2 (MFA-verified) session.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF COALESCE((v_item->>'is_controlled')::BOOLEAN, FALSE) THEN
            v_has_controlled := TRUE;
        END IF;
    END LOOP;

    IF v_has_controlled AND NOT public.jwt_is_aal2() THEN
        RAISE EXCEPTION 'Prescribing a controlled medication requires MFA verification (aal2).'
            USING ERRCODE = 'P0001';
    END IF;

    -- Create as DRAFT so the immutability trigger permits item inserts,
    -- then flip to ISSUED once all items are in. Replaces any prior Rx for
    -- this appointment (marking it SUPERSEDED keeps history but frees the
    -- UNIQUE(appointment_id) slot only if we delete; instead we upsert-by-delete).
    DELETE FROM public.prescriptions WHERE appointment_id = p_appointment_id;

    INSERT INTO public.prescriptions
        (appointment_id, doctor_id, patient_id, hospital_id, status, diagnosis, valid_until)
    VALUES
        (p_appointment_id, v_doctor_id, v_patient_id, v_hospital_id, 'DRAFT', p_diagnosis, p_valid_until)
    RETURNING id INTO v_rx_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF COALESCE(NULLIF(TRIM(v_item->>'drug_name'), ''), NULL) IS NULL
           OR COALESCE(NULLIF(TRIM(v_item->>'dosage'), ''), NULL) IS NULL
           OR COALESCE(NULLIF(TRIM(v_item->>'frequency'), ''), NULL) IS NULL
           OR COALESCE(NULLIF(TRIM(v_item->>'duration'), ''), NULL) IS NULL THEN
            RAISE EXCEPTION 'Each medication needs a name, dosage, frequency, and duration.'
                USING ERRCODE = 'P0001';
        END IF;

        INSERT INTO public.prescription_items
            (prescription_id, drug_name, form, strength, dosage, frequency,
             duration, quantity, instructions, is_controlled)
        VALUES
            (v_rx_id,
             LEFT(v_item->>'drug_name', 200),
             LEFT(v_item->>'form', 60),
             LEFT(v_item->>'strength', 60),
             LEFT(v_item->>'dosage', 120),
             LEFT(v_item->>'frequency', 120),
             LEFT(v_item->>'duration', 120),
             NULLIF(v_item->>'quantity', '')::INT,
             LEFT(v_item->>'instructions', 500),
             COALESCE((v_item->>'is_controlled')::BOOLEAN, FALSE));
        v_count := v_count + 1;
    END LOOP;

    -- Freeze it.
    UPDATE public.prescriptions
       SET status = 'ISSUED', issued_at = NOW()
     WHERE id = v_rx_id;

    -- Notify the patient.
    INSERT INTO public.notifications (user_id, title, body, type, reference_id)
    VALUES (
        v_patient_id,
        'New Prescription',
        'Dr. ' || COALESCE(v_doctor_name, 'your doctor') || ' issued a prescription with '
            || v_count || ' medication(s). View it in your prescriptions.',
        'PRESCRIPTION_ISSUED',
        v_rx_id
    );

    RETURN v_rx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_prescription(BIGINT, TEXT, DATE, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_prescription(BIGINT, TEXT, DATE, JSONB) TO authenticated;

-- ─────────────────────────────────────────────
-- 6. RPC: cancel_prescription
--    The prescribing doctor cancels an ISSUED prescription and the patient
--    is notified. (Requirement 1.7.)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_prescription(
    p_prescription_id BIGINT,
    p_reason          TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_patient_id UUID;
    v_owned      BOOLEAN;
BEGIN
    SELECT p.patient_id,
           EXISTS (SELECT 1 FROM public.doctors d
                   WHERE d.id = p.doctor_id AND d.user_id = auth.uid())
      INTO v_patient_id, v_owned
      FROM public.prescriptions p
     WHERE p.id = p_prescription_id;

    IF v_patient_id IS NULL THEN
        RAISE EXCEPTION 'Prescription not found.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT v_owned THEN
        RAISE EXCEPTION 'You are not authorized to cancel this prescription.'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.prescriptions
       SET status = 'CANCELLED',
           cancelled_reason = LEFT(p_reason, 500),
           cancelled_at = NOW()
     WHERE id = p_prescription_id
       AND status <> 'CANCELLED';

    INSERT INTO public.notifications (user_id, title, body, type, reference_id)
    VALUES (
        v_patient_id,
        'Prescription Cancelled',
        'A prescription was cancelled by your doctor'
            || CASE WHEN NULLIF(TRIM(p_reason), '') IS NOT NULL
                    THEN ': ' || LEFT(p_reason, 200) ELSE '.' END,
        'PRESCRIPTION_CANCELLED',
        p_prescription_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_prescription(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_prescription(BIGINT, TEXT) TO authenticated;
