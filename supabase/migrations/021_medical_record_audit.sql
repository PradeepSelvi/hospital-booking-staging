-- ═══════════════════════════════════════════════════════════════
-- MEDICAL RECORD ACCESS AUDIT
--
-- Server-side, tamper-resistant logging of who views a patient's medical
-- records. The client cannot forge or skip these entries: reads go through
-- SECURITY DEFINER functions that record the access using auth.uid().
--
-- Depends on: 019_medical_history (medical_history, medical_documents,
--             doctor_has_record_access()).
-- Run after 020. Idempotent / safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. ACCESS LOG TABLE (append-only)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medical_record_access_log (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    accessor_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,  -- who viewed
    patient_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,  -- whose records
    doctor_id    BIGINT REFERENCES public.doctors(id) ON DELETE SET NULL,
    access_type  TEXT NOT NULL CHECK (access_type IN ('RECORDS_VIEW', 'DOCUMENT_VIEW')),
    document_id  BIGINT,  -- no FK: keep the log row even if the document is deleted
    accessed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_record_access_patient
    ON public.medical_record_access_log(patient_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_record_access_accessor
    ON public.medical_record_access_log(accessor_id, accessed_at DESC);

-- ─────────────────────────────────────────────
-- 2. RLS — read for the patient (transparency), the accessor, and admins.
--    No INSERT/UPDATE/DELETE policy for authenticated users: rows are written
--    only by the SECURITY DEFINER functions below, and never edited.
-- ─────────────────────────────────────────────
ALTER TABLE public.medical_record_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mral_patient_read" ON public.medical_record_access_log;
CREATE POLICY "mral_patient_read" ON public.medical_record_access_log
    FOR SELECT USING (patient_id = auth.uid());

DROP POLICY IF EXISTS "mral_accessor_read" ON public.medical_record_access_log;
CREATE POLICY "mral_accessor_read" ON public.medical_record_access_log
    FOR SELECT USING (accessor_id = auth.uid());

DROP POLICY IF EXISTS "mral_admin_read" ON public.medical_record_access_log;
CREATE POLICY "mral_admin_read" ON public.medical_record_access_log
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- ─────────────────────────────────────────────
-- 3. AUDITED READ: a doctor fetches a patient's records.
--    Returns { history, documents } as JSONB and logs the access atomically.
--    Access is gated by doctor_has_record_access (patient must have granted it).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_patient_records_for_doctor(p_patient_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_doctor_id BIGINT;
    v_result    JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    -- No consent → no data, and nothing is logged.
    IF NOT public.doctor_has_record_access(p_patient_id) THEN
        RETURN jsonb_build_object('history', NULL, 'documents', '[]'::jsonb);
    END IF;

    SELECT id INTO v_doctor_id FROM public.doctors WHERE user_id = auth.uid();

    INSERT INTO public.medical_record_access_log (accessor_id, patient_id, doctor_id, access_type)
    VALUES (auth.uid(), p_patient_id, v_doctor_id, 'RECORDS_VIEW');

    v_result := jsonb_build_object(
        'history', (SELECT to_jsonb(mh) FROM public.medical_history mh WHERE mh.patient_id = p_patient_id),
        'documents', COALESCE(
            (SELECT jsonb_agg(to_jsonb(md) ORDER BY md.uploaded_at)
             FROM public.medical_documents md WHERE md.patient_id = p_patient_id),
            '[]'::jsonb)
    );
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_patient_records_for_doctor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_patient_records_for_doctor(UUID) TO authenticated;

-- ─────────────────────────────────────────────
-- 4. LOG A SINGLE DOCUMENT VIEW (when a doctor opens a file).
--    No-op when the viewer is the owning patient or lacks access.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_medical_document_access(p_document_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_patient_id UUID;
    v_doctor_id  BIGINT;
BEGIN
    SELECT patient_id INTO v_patient_id FROM public.medical_documents WHERE id = p_document_id;
    IF v_patient_id IS NULL THEN RETURN; END IF;

    -- Patient viewing their own file → not an audited access.
    IF v_patient_id = auth.uid() THEN RETURN; END IF;

    -- Only log genuine, consented doctor access.
    IF NOT public.doctor_has_record_access(v_patient_id) THEN RETURN; END IF;

    SELECT id INTO v_doctor_id FROM public.doctors WHERE user_id = auth.uid();

    INSERT INTO public.medical_record_access_log (accessor_id, patient_id, doctor_id, access_type, document_id)
    VALUES (auth.uid(), v_patient_id, v_doctor_id, 'DOCUMENT_VIEW', p_document_id);
END;
$$;

REVOKE ALL ON FUNCTION public.log_medical_document_access(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_medical_document_access(BIGINT) TO authenticated;
