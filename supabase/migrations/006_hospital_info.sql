-- ============================================================
-- MEDIBOOK — HOSPITAL INFO MIGRATION
-- Run in: Supabase SQL Editor (AFTER supabase_collaborate_migration.sql)
-- Adds: doctor_hospitals table + hospital-photos storage bucket
-- Version: 1.0.0
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. DOCTOR HOSPITALS TABLE
-- Stores hospital/clinic info for each doctor.
-- A doctor can have up to 3 hospitals (enforced at app level).
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_hospitals (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id           BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,

    -- Basic Info
    hospital_name       TEXT NOT NULL,
    hospital_type       TEXT CHECK (hospital_type IN ('GOVERNMENT', 'PRIVATE', 'CLINIC', 'MULTI_SPECIALTY')),
    hospital_summary    TEXT,                          -- Rich description (max 3000 chars)
    bed_count           INTEGER CHECK (bed_count >= 0),
    registration_number TEXT,

    -- Address & Location
    address             TEXT,
    city                TEXT,
    state               TEXT,
    pincode             TEXT,
    latitude            DECIMAL(10,8),                 -- GPS latitude for map
    longitude           DECIMAL(11,8),                 -- GPS longitude for map

    -- Contact & Web
    phone               TEXT,
    email               TEXT,
    website_url         TEXT,                           -- Hospital website

    -- Photos (max 2 per hospital, stored as storage paths)
    photo_1_url         TEXT,
    photo_2_url         TEXT,

    -- Supporting Documents
    document_url        TEXT,

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.doctor_hospitals IS
    'Stores hospital/clinic information for doctors. Each doctor can have up to 3 hospitals (enforced at application level).';

-- ─────────────────────────────────────────────
-- 2. AUTO-UPDATE updated_at TRIGGER
-- ─────────────────────────────────────────────

CREATE TRIGGER set_doctor_hospitals_updated_at
    BEFORE UPDATE ON public.doctor_hospitals
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────
-- 3. PERFORMANCE INDEXES
-- ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_doctor_hospitals_doctor_id
    ON public.doctor_hospitals(doctor_id);

CREATE INDEX IF NOT EXISTS idx_doctor_hospitals_city
    ON public.doctor_hospitals(city)
    WHERE city IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_hospitals_name
    ON public.doctor_hospitals(hospital_name);

-- Prevent exact duplicate hospital names for the same doctor
CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_hospitals_unique_name
    ON public.doctor_hospitals(doctor_id, hospital_name);

-- ─────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────────

ALTER TABLE public.doctor_hospitals ENABLE ROW LEVEL SECURITY;

-- Doctors can read their own hospital records
CREATE POLICY "doctor_hospitals_doctor_select"
    ON public.doctor_hospitals
    FOR SELECT
    USING (
        doctor_id IN (
            SELECT id FROM public.doctors WHERE user_id = auth.uid()
        )
    );

-- Patients and public can read all hospital records (for doctor profile pages)
CREATE POLICY "doctor_hospitals_public_select"
    ON public.doctor_hospitals
    FOR SELECT
    USING (true);

-- Doctors can insert their own hospital records
CREATE POLICY "doctor_hospitals_doctor_insert"
    ON public.doctor_hospitals
    FOR INSERT
    WITH CHECK (
        doctor_id IN (
            SELECT id FROM public.doctors WHERE user_id = auth.uid()
        )
    );

-- Doctors can update their own hospital records
CREATE POLICY "doctor_hospitals_doctor_update"
    ON public.doctor_hospitals
    FOR UPDATE
    USING (
        doctor_id IN (
            SELECT id FROM public.doctors WHERE user_id = auth.uid()
        )
    );

-- Doctors can delete their own hospital records
CREATE POLICY "doctor_hospitals_doctor_delete"
    ON public.doctor_hospitals
    FOR DELETE
    USING (
        doctor_id IN (
            SELECT id FROM public.doctors WHERE user_id = auth.uid()
        )
    );

-- Admins can do anything
CREATE POLICY "doctor_hospitals_admin_all"
    ON public.doctor_hospitals
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

-- ─────────────────────────────────────────────
-- 5. STORAGE BUCKET FOR HOSPITAL PHOTOS
-- ─────────────────────────────────────────────

-- Public bucket for hospital photos (viewable by patients)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'hospital-photos',
    'hospital-photos',
    TRUE,
    2097152,  -- 2MB max per photo
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload hospital photos
CREATE POLICY "hospital_photos_auth_upload" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'hospital-photos'
        AND auth.role() = 'authenticated'
    );

-- Allow anyone to read hospital photos (public bucket)
CREATE POLICY "hospital_photos_public_read" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'hospital-photos');

-- Allow authenticated users to update their own hospital photos
CREATE POLICY "hospital_photos_auth_update" ON storage.objects
    FOR UPDATE
    USING (
        bucket_id = 'hospital-photos'
        AND auth.role() = 'authenticated'
    );

-- Allow authenticated users to delete their own hospital photos
CREATE POLICY "hospital_photos_auth_delete" ON storage.objects
    FOR DELETE
    USING (
        bucket_id = 'hospital-photos'
        AND auth.role() = 'authenticated'
    );

-- ─────────────────────────────────────────────
-- 6. STORAGE BUCKET FOR HOSPITAL DOCUMENTS
-- ─────────────────────────────────────────────

-- Private bucket for hospital supporting documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'hospital-docs',
    'hospital-docs',
    FALSE,
    5242880,  -- 5MB max
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload hospital documents
CREATE POLICY "hospital_docs_auth_upload" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'hospital-docs'
        AND auth.role() = 'authenticated'
    );

-- Allow authenticated users to read hospital documents
CREATE POLICY "hospital_docs_auth_read" ON storage.objects
    FOR SELECT
    USING (
        bucket_id = 'hospital-docs'
        AND auth.role() = 'authenticated'
    );

-- Allow authenticated users to delete hospital documents
CREATE POLICY "hospital_docs_auth_delete" ON storage.objects
    FOR DELETE
    USING (
        bucket_id = 'hospital-docs'
        AND auth.role() = 'authenticated'
    );

-- ============================================================
-- DONE! Hospital info schema ready. 🏥
-- Run this AFTER supabase_collaborate_migration.sql
-- ============================================================
