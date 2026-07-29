-- ═══════════════════════════════════════════════════════════════
-- APPOINTMENT CONCURRENCY MIGRATION
-- Atomic booking + slot capacity + double-booking prevention
-- Safe to run multiple times (idempotent).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. SAFETY NET: partial unique index
--    (already in base migration, re-asserted here so this file is self-contained)
--    Guarantees: at most ONE active (PENDING/CONFIRMED) appointment
--    per (doctor, date, slot). This is the ultimate race-condition guard.
-- ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_slot
    ON public.appointments(doctor_id, appointment_date, slot_start_time)
    WHERE status IN ('PENDING', 'CONFIRMED');


-- ─────────────────────────────────────────────
-- 2. ATOMIC BOOKING FUNCTION
--    Does validation + end-time calc + insert in a SINGLE transaction.
--    No check-then-insert race window: the INSERT itself is the check,
--    enforced by idx_appointments_active_slot.
--
--    SECURITY INVOKER (default) → RLS still applies.
--    We derive patient_id from auth.uid() so a user can never book
--    on behalf of someone else.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_appointment(
    p_doctor_id   BIGINT,
    p_date        DATE,
    p_start_time  TIME,
    p_reason      TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
AS $$
DECLARE
    v_patient_id   UUID := auth.uid();
    v_duration     INT;
    v_end_time     TIME;
    v_day          TEXT;
    v_is_active    BOOLEAN;
    v_new_row      public.appointments;
BEGIN
    -- Must be authenticated
    IF v_patient_id IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to book an appointment.'
            USING ERRCODE = '28000';
    END IF;

    -- No past dates
    IF p_date < CURRENT_DATE THEN
        RAISE EXCEPTION 'Cannot book appointments in the past.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Doctor must exist and be active
    SELECT is_active INTO v_is_active
    FROM public.doctors WHERE id = p_doctor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Doctor not found.' USING ERRCODE = 'P0001';
    END IF;
    IF v_is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'This doctor is currently unavailable.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Derive slot duration from the doctor's availability for that weekday
    v_day := CASE EXTRACT(DOW FROM p_date)::INT
        WHEN 0 THEN 'SUN' WHEN 1 THEN 'MON' WHEN 2 THEN 'TUE'
        WHEN 3 THEN 'WED' WHEN 4 THEN 'THU' WHEN 5 THEN 'FRI'
        WHEN 6 THEN 'SAT' END;

    SELECT slot_duration_mins INTO v_duration
    FROM public.doctor_availability
    WHERE doctor_id = p_doctor_id AND day_of_week = v_day
    LIMIT 1;

    v_duration := COALESCE(v_duration, 30);
    v_end_time := p_start_time + (v_duration || ' minutes')::INTERVAL;

    -- ── The atomic part ──
    -- The unique index makes this INSERT the single source of truth.
    -- If a concurrent transaction already took the slot, this throws 23505.
    BEGIN
        INSERT INTO public.appointments (
            patient_id, doctor_id, appointment_date,
            slot_start_time, slot_end_time, reason, status
        )
        VALUES (
            v_patient_id, p_doctor_id, p_date,
            p_start_time, v_end_time, NULLIF(p_reason, ''), 'PENDING'
        )
        RETURNING * INTO v_new_row;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'This time slot was just booked by someone else. Please pick another slot.'
                USING ERRCODE = 'P0002';
    END;

    RETURN v_new_row;
END;
$$;

-- Allow logged-in users to call it
REVOKE ALL ON FUNCTION public.book_appointment(BIGINT, DATE, TIME, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_appointment(BIGINT, DATE, TIME, TEXT) TO authenticated;


-- ─────────────────────────────────────────────
-- 3. (OPTIONAL) SLOT CAPACITY > 1  — "appointment full" model
--    Use this only if a slot can hold more than one patient
--    (e.g. group sessions, or a doctor with N parallel rooms).
--    If every slot is strictly 1 patient, SKIP this section —
--    the unique index above already means "full = taken".
-- ─────────────────────────────────────────────

-- Add an optional capacity column to availability (default 1 = exclusive slot)
ALTER TABLE public.doctor_availability
    ADD COLUMN IF NOT EXISTS slot_capacity INT NOT NULL DEFAULT 1
    CHECK (slot_capacity >= 1);

-- Atomic capacity-aware booking. Uses a transaction-level advisory lock
-- keyed on (doctor, date, slot) so concurrent bookings for the SAME slot
-- are serialized, then re-counts inside the lock before inserting.
CREATE OR REPLACE FUNCTION public.book_appointment_with_capacity(
    p_doctor_id   BIGINT,
    p_date        DATE,
    p_start_time  TIME,
    p_reason      TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
AS $$
DECLARE
    v_patient_id  UUID := auth.uid();
    v_capacity    INT;
    v_taken       INT;
    v_duration    INT;
    v_end_time    TIME;
    v_day         TEXT;
    v_lock_key    BIGINT;
    v_new_row     public.appointments;
BEGIN
    IF v_patient_id IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to book an appointment.' USING ERRCODE = '28000';
    END IF;
    IF p_date < CURRENT_DATE THEN
        RAISE EXCEPTION 'Cannot book appointments in the past.' USING ERRCODE = 'P0001';
    END IF;

    v_day := CASE EXTRACT(DOW FROM p_date)::INT
        WHEN 0 THEN 'SUN' WHEN 1 THEN 'MON' WHEN 2 THEN 'TUE'
        WHEN 3 THEN 'WED' WHEN 4 THEN 'THU' WHEN 5 THEN 'FRI'
        WHEN 6 THEN 'SAT' END;

    SELECT slot_duration_mins, slot_capacity
      INTO v_duration, v_capacity
    FROM public.doctor_availability
    WHERE doctor_id = p_doctor_id AND day_of_week = v_day
    LIMIT 1;

    v_duration := COALESCE(v_duration, 30);
    v_capacity := COALESCE(v_capacity, 1);
    v_end_time := p_start_time + (v_duration || ' minutes')::INTERVAL;

    -- Serialize concurrent callers for THIS exact slot only.
    -- Lock is released automatically at end of transaction.
    v_lock_key := hashtextextended(
        p_doctor_id::TEXT || ':' || p_date::TEXT || ':' || p_start_time::TEXT, 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT COUNT(*) INTO v_taken
    FROM public.appointments
    WHERE doctor_id = p_doctor_id
      AND appointment_date = p_date
      AND slot_start_time = p_start_time
      AND status IN ('PENDING', 'CONFIRMED');

    IF v_taken >= v_capacity THEN
        RAISE EXCEPTION 'This slot is full. Please choose another time.' USING ERRCODE = 'P0003';
    END IF;

    INSERT INTO public.appointments (
        patient_id, doctor_id, appointment_date,
        slot_start_time, slot_end_time, reason, status
    )
    VALUES (
        v_patient_id, p_doctor_id, p_date,
        p_start_time, v_end_time, NULLIF(p_reason, ''), 'PENDING'
    )
    RETURNING * INTO v_new_row;

    RETURN v_new_row;
END;
$$;

REVOKE ALL ON FUNCTION public.book_appointment_with_capacity(BIGINT, DATE, TIME, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_appointment_with_capacity(BIGINT, DATE, TIME, TEXT) TO authenticated;

-- NOTE: if you enable capacity > 1, you MUST drop the strict unique index,
-- because it forbids a second active row per slot. Run this ONLY then:
--   DROP INDEX IF EXISTS public.idx_appointments_active_slot;
