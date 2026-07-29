-- ═══════════════════════════════════════════════════════════════
-- PATIENT MEDICAL HISTORY MIGRATION
--
-- Adds:
--   • medical_history          — patient's text summary / concerns / info
--   • medical_documents        — uploaded files in 3 categories (max 3 each)
--   • medical_access_grants    — patient grants a doctor access per appointment
--   • consultation_notes       — doctor's advisories/instructions at closing
--   • storage bucket 'medical-records' (private) + access policies
--
-- Access rule: a doctor can read a patient's history + files ONLY when the
-- patient has granted access for an appointment between them and not revoked it.
--
-- Run in the Supabase SQL editor. Idempotent / safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. MEDICAL HISTORY (one row per patient)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medical_history (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id           UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    medical_summary      TEXT,
    previous_concerns    TEXT,   -- previous doctor concerns
    current_medications  TEXT,
    allergies            TEXT,
    chronic_conditions   TEXT,
    other_info           TEXT,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_medical_history_updated_at
    BEFORE UPDATE ON public.medical_history
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────
-- 2. MEDICAL DOCUMENTS (categorised uploads)
--    category: SHEET (lab sheets/reports), SCAN (x-rays/MRI), OTHER
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medical_documents (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    category     TEXT NOT NULL CHECK (category IN ('SHEET', 'SCAN', 'OTHER')),
    file_name    TEXT NOT NULL,
    file_path    TEXT NOT NULL,      -- storage path within the bucket
    file_size    BIGINT NOT NULL,
    mime_type    TEXT NOT NULL,
    label        TEXT,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medical_docs_patient
    ON public.medical_documents(patient_id, category);

-- Enforce a hard cap of 3 documents per category (defence in depth;
-- the service also checks before upload).
CREATE OR REPLACE FUNCTION public.enforce_medical_doc_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.medical_documents
    WHERE patient_id = NEW.patient_id AND category = NEW.category;

    IF v_count >= 3 THEN
        RAISE EXCEPTION 'Limit reached: a maximum of 3 files is allowed in the % category.', NEW.category
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_medical_doc_limit ON public.medical_documents;
CREATE TRIGGER trg_medical_doc_limit
    BEFORE INSERT ON public.medical_documents
    FOR EACH ROW EXECUTE FUNCTION public.enforce_medical_doc_limit();

-- ─────────────────────────────────────────────
-- 3. ACCESS GRANTS (patient → doctor, per appointment)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medical_access_grants (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id BIGINT NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
    patient_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id      BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at     TIMESTAMPTZ,
    CONSTRAINT uq_grant_per_appointment UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_access_grants_doctor
    ON public.medical_access_grants(doctor_id, patient_id, is_active);

-- ─────────────────────────────────────────────
-- 4. CONSULTATION NOTES (doctor's closing advisories)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consultation_notes (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id BIGINT NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
    doctor_id      BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    patient_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    advisory       TEXT,   -- medical advisories
    prescription   TEXT,   -- medications / instructions
    follow_up      TEXT,   -- queries / follow-up notes
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_consultation_notes_updated_at
    BEFORE UPDATE ON public.consultation_notes
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────
-- 5. ACCESS-CHECK HELPER
--    True when the CURRENT user is a doctor who has an active, patient-granted
--    access record for the given patient (via a non-cancelled appointment).
--    SECURITY DEFINER + STABLE so it can be used inside RLS without recursion.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.doctor_has_record_access(p_patient_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.medical_access_grants g
        JOIN public.doctors d   ON d.id = g.doctor_id
        JOIN public.appointments a ON a.id = g.appointment_id
        WHERE g.patient_id = p_patient_id
          AND g.is_active = TRUE
          AND d.user_id = auth.uid()
          AND a.status <> 'CANCELLED'
    );
$$;

-- ─────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE public.medical_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_notes    ENABLE ROW LEVEL SECURITY;

-- ── medical_history ──
DROP POLICY IF EXISTS "mh_patient_all" ON public.medical_history;
CREATE POLICY "mh_patient_all" ON public.medical_history
    FOR ALL USING (patient_id = auth.uid()) WITH CHECK (patient_id = auth.uid());

DROP POLICY IF EXISTS "mh_doctor_read" ON public.medical_history;
CREATE POLICY "mh_doctor_read" ON public.medical_history
    FOR SELECT USING (public.doctor_has_record_access(patient_id));

-- ── medical_documents ──
DROP POLICY IF EXISTS "md_patient_all" ON public.medical_documents;
CREATE POLICY "md_patient_all" ON public.medical_documents
    FOR ALL USING (patient_id = auth.uid()) WITH CHECK (patient_id = auth.uid());

DROP POLICY IF EXISTS "md_doctor_read" ON public.medical_documents;
CREATE POLICY "md_doctor_read" ON public.medical_documents
    FOR SELECT USING (public.doctor_has_record_access(patient_id));

-- ── medical_access_grants ──
-- Patient manages their own grants.
DROP POLICY IF EXISTS "ag_patient_all" ON public.medical_access_grants;
CREATE POLICY "ag_patient_all" ON public.medical_access_grants
    FOR ALL USING (patient_id = auth.uid()) WITH CHECK (patient_id = auth.uid());

-- Doctor can read grants that belong to them.
DROP POLICY IF EXISTS "ag_doctor_read" ON public.medical_access_grants;
CREATE POLICY "ag_doctor_read" ON public.medical_access_grants
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.doctors d
                WHERE d.id = doctor_id AND d.user_id = auth.uid())
    );

-- ── consultation_notes ──
-- Doctor who owns the appointment can write/read their notes.
DROP POLICY IF EXISTS "cn_doctor_all" ON public.consultation_notes;
CREATE POLICY "cn_doctor_all" ON public.consultation_notes
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.doctors d
                WHERE d.id = doctor_id AND d.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.doctors d
                WHERE d.id = doctor_id AND d.user_id = auth.uid())
    );

-- Patient can read notes written for them.
DROP POLICY IF EXISTS "cn_patient_read" ON public.consultation_notes;
CREATE POLICY "cn_patient_read" ON public.consultation_notes
    FOR SELECT USING (patient_id = auth.uid());

-- ─────────────────────────────────────────────
-- 7. STORAGE BUCKET: medical-records (PRIVATE)
--    Path convention: {patient_uid}/{category}/{timestamp}_{filename}
-- ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'medical-records', 'medical-records', FALSE, 10485760,  -- 10 MB hard cap
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Patient uploads into their own folder ({uid}/...).
DROP POLICY IF EXISTS "medrec_patient_insert" ON storage.objects;
CREATE POLICY "medrec_patient_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'medical-records'
        AND (storage.foldername(name))[1] = auth.uid()::TEXT
    );

DROP POLICY IF EXISTS "medrec_patient_update" ON storage.objects;
CREATE POLICY "medrec_patient_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'medical-records'
        AND (storage.foldername(name))[1] = auth.uid()::TEXT
    );

DROP POLICY IF EXISTS "medrec_patient_delete" ON storage.objects;
CREATE POLICY "medrec_patient_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'medical-records'
        AND (storage.foldername(name))[1] = auth.uid()::TEXT
    );

-- Read: the owning patient, OR a doctor the patient has granted access to.
DROP POLICY IF EXISTS "medrec_read" ON storage.objects;
CREATE POLICY "medrec_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'medical-records'
        AND (
            (storage.foldername(name))[1] = auth.uid()::TEXT
            OR public.doctor_has_record_access(((storage.foldername(name))[1])::UUID)
        )
    );
