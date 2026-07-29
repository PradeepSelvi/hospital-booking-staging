-- ═══════════════════════════════════════════════════════════════
-- EARLY-COMPLETION / FREED-SLOT MIGRATION
--
-- Scenario: a patient books 09:00–09:30 (a 30-min slot). The doctor
-- finishes early at 09:15. The remaining 09:15–09:30 window is released
-- as a "freed slot", and patients on the waitlist for that doctor/day are
-- notified so someone can book it. Booking the freed slot is race-safe.
--
-- Run in the Supabase SQL editor. Idempotent / safe to re-run.
-- Requires: base schema + notification_enhancement.sql already applied.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Track when an appointment was actually completed
-- ─────────────────────────────────────────────
ALTER TABLE public.appointments
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────
-- 2. Allow the new notification type
-- ─────────────────────────────────────────────
ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'APPOINTMENT_BOOKED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED',
        'REMINDER_24H', 'REMINDER_1H', 'APPOINTMENT_COMPLETED', 'SYSTEM',
        'SLOT_AVAILABLE'
    ));

-- ─────────────────────────────────────────────
-- 3. FREED SLOTS — released windows available to book
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freed_slots (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id             BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    appointment_date      DATE NOT NULL,
    available_from        TIME NOT NULL,
    available_to          TIME NOT NULL,
    source_appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
    status                TEXT NOT NULL DEFAULT 'OPEN'
                              CHECK (status IN ('OPEN', 'BOOKED', 'EXPIRED')),
    booked_appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_freed_range CHECK (available_to > available_from)
);

CREATE INDEX IF NOT EXISTS idx_freed_slots_lookup
    ON public.freed_slots(doctor_id, appointment_date, status);

-- One OPEN freed slot per (doctor, date, start) — prevents duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_freed_slots_open_unique
    ON public.freed_slots(doctor_id, appointment_date, available_from)
    WHERE status = 'OPEN';

-- ─────────────────────────────────────────────
-- 4. WAITLIST — patients who want to be notified when a slot opens
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.appointment_waitlist (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id        BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    appointment_date DATE NOT NULL,
    status           TEXT NOT NULL DEFAULT 'WAITING'
                         CHECK (status IN ('WAITING', 'NOTIFIED', 'BOOKED', 'CANCELLED')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notified_at      TIMESTAMPTZ,
    CONSTRAINT uq_waitlist_entry UNIQUE (patient_id, doctor_id, appointment_date)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_doctor_date
    ON public.appointment_waitlist(doctor_id, appointment_date, status);

-- ─────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────
ALTER TABLE public.freed_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_waitlist ENABLE ROW LEVEL SECURITY;

-- Freed slots are public to read (so patients can see open windows).
DROP POLICY IF EXISTS "freed_slots_select_all" ON public.freed_slots;
CREATE POLICY "freed_slots_select_all" ON public.freed_slots
    FOR SELECT USING (true);

-- Patients manage only their own waitlist rows.
DROP POLICY IF EXISTS "waitlist_select_own" ON public.appointment_waitlist;
CREATE POLICY "waitlist_select_own" ON public.appointment_waitlist
    FOR SELECT USING (patient_id = auth.uid());
DROP POLICY IF EXISTS "waitlist_insert_own" ON public.appointment_waitlist;
CREATE POLICY "waitlist_insert_own" ON public.appointment_waitlist
    FOR INSERT WITH CHECK (patient_id = auth.uid());
DROP POLICY IF EXISTS "waitlist_update_own" ON public.appointment_waitlist;
CREATE POLICY "waitlist_update_own" ON public.appointment_waitlist
    FOR UPDATE USING (patient_id = auth.uid());

-- ─────────────────────────────────────────────
-- 6. COMPLETE EARLY → release remaining time + notify waitlist
--
--    SECURITY DEFINER so it can read the waitlist of other patients and
--    insert notifications for them. The caller is verified to be the
--    doctor who owns the appointment, so this can't be abused.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_appointment_early(
    p_appointment_id BIGINT
)
RETURNS public.freed_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_apt          public.appointments;
    v_doctor_owner UUID;
    v_doctor_name  TEXT;
    v_now_time     TIME := (NOW() AT TIME ZONE 'utc')::TIME;  -- adjust TZ if needed
    v_from         TIME;
    v_freed        public.freed_slots;
    v_wait         RECORD;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_apt FROM public.appointments WHERE id = p_appointment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Appointment not found.' USING ERRCODE = 'P0001';
    END IF;

    -- Caller must be the doctor who owns this appointment.
    SELECT d.user_id, pr.name
      INTO v_doctor_owner, v_doctor_name
    FROM public.doctors d
    JOIN public.profiles pr ON pr.id = d.user_id
    WHERE d.id = v_apt.doctor_id;

    IF v_doctor_owner IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Only the assigned doctor can complete this appointment.'
            USING ERRCODE = '42501';
    END IF;

    IF v_apt.status = 'COMPLETED' THEN
        RAISE EXCEPTION 'Appointment is already completed.' USING ERRCODE = 'P0001';
    END IF;
    IF v_apt.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Cannot complete a cancelled appointment.' USING ERRCODE = 'P0001';
    END IF;

    -- Mark completed with the actual finish time.
    UPDATE public.appointments
       SET status = 'COMPLETED', completed_at = NOW()
     WHERE id = p_appointment_id;

    -- Only release time if finishing on the same day, before the slot end.
    -- The freed window starts at "now" (rounded down to the minute), capped
    -- to the original slot's start so it never predates the booking.
    IF v_apt.appointment_date = (NOW() AT TIME ZONE 'utc')::DATE
       AND date_trunc('minute', v_now_time) < v_apt.slot_end_time THEN

        v_from := GREATEST(date_trunc('minute', v_now_time)::TIME, v_apt.slot_start_time);

        IF v_from < v_apt.slot_end_time THEN
            INSERT INTO public.freed_slots (
                doctor_id, appointment_date, available_from, available_to,
                source_appointment_id, status
            )
            VALUES (
                v_apt.doctor_id, v_apt.appointment_date, v_from,
                v_apt.slot_end_time, p_appointment_id, 'OPEN'
            )
            ON CONFLICT (doctor_id, appointment_date, available_from)
                WHERE status = 'OPEN' DO NOTHING
            RETURNING * INTO v_freed;

            -- Notify everyone waiting for this doctor on this date.
            IF v_freed.id IS NOT NULL THEN
                FOR v_wait IN
                    SELECT patient_id FROM public.appointment_waitlist
                    WHERE doctor_id = v_apt.doctor_id
                      AND appointment_date = v_apt.appointment_date
                      AND status = 'WAITING'
                LOOP
                    INSERT INTO public.notifications (user_id, title, body, type, reference_id)
                    VALUES (
                        v_wait.patient_id,
                        'A slot just opened up',
                        'Dr. ' || COALESCE(v_doctor_name, 'your doctor')
                            || ' is free from ' || to_char(v_freed.available_from, 'HH24:MI')
                            || ' today. Book now before someone else does.',
                        'SLOT_AVAILABLE',
                        v_freed.id
                    );
                END LOOP;

                UPDATE public.appointment_waitlist
                   SET status = 'NOTIFIED', notified_at = NOW()
                 WHERE doctor_id = v_apt.doctor_id
                   AND appointment_date = v_apt.appointment_date
                   AND status = 'WAITING';
            END IF;
        END IF;
    END IF;

    RETURN v_freed;  -- NULL row if nothing was freed
END;
$$;

REVOKE ALL ON FUNCTION public.complete_appointment_early(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_appointment_early(BIGINT) TO authenticated;


-- ─────────────────────────────────────────────
-- 7. BOOK A FREED SLOT — race-safe claim
--
--    Two patients tapping the same freed slot: the UPDATE ... WHERE
--    status='OPEN' only succeeds for one of them (row-level lock).
--    The loser gets a clean "already taken" message.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_freed_slot(
    p_freed_slot_id BIGINT,
    p_reason        TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
AS $$
DECLARE
    v_patient_id UUID := auth.uid();
    v_slot       public.freed_slots;
    v_new_row    public.appointments;
BEGIN
    IF v_patient_id IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to book.' USING ERRCODE = '28000';
    END IF;

    -- Atomically claim the slot: only one caller wins this UPDATE.
    UPDATE public.freed_slots
       SET status = 'BOOKED'
     WHERE id = p_freed_slot_id AND status = 'OPEN'
    RETURNING * INTO v_slot;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'This freed slot has already been taken. Please pick another.'
            USING ERRCODE = 'P0002';
    END IF;

    BEGIN
        INSERT INTO public.appointments (
            patient_id, doctor_id, appointment_date,
            slot_start_time, slot_end_time, reason, status
        )
        VALUES (
            v_patient_id, v_slot.doctor_id, v_slot.appointment_date,
            v_slot.available_from, v_slot.available_to,
            NULLIF(p_reason, ''), 'PENDING'
        )
        RETURNING * INTO v_new_row;
    EXCEPTION
        WHEN unique_violation THEN
            -- Roll the claim back so the slot can be retried.
            UPDATE public.freed_slots SET status = 'OPEN' WHERE id = p_freed_slot_id;
            RAISE EXCEPTION 'This time was just booked by someone else. Please pick another.'
                USING ERRCODE = 'P0002';
    END;

    UPDATE public.freed_slots
       SET booked_appointment_id = v_new_row.id
     WHERE id = p_freed_slot_id;

    -- Mark this patient's waitlist entry as booked, if any.
    UPDATE public.appointment_waitlist
       SET status = 'BOOKED'
     WHERE patient_id = v_patient_id
       AND doctor_id = v_slot.doctor_id
       AND appointment_date = v_slot.appointment_date;

    RETURN v_new_row;
END;
$$;

REVOKE ALL ON FUNCTION public.book_freed_slot(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_freed_slot(BIGINT, TEXT) TO authenticated;
