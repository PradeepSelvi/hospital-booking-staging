-- ============================================================
-- MEDIBOOK — HOSPITAL MANAGEMENT MIGRATION
-- Run in: Supabase SQL Editor
--   AFTER: supabase_migration.sql
--          supabase_collaborate_migration.sql
--          supabase/security_fix.sql
-- Version: 1.0.0
--
-- Introduces standalone HOSPITAL accounts (first-class) that
-- doctors can self-join. Adds:
--   • hospitals table
--   • hospital_photos table (gallery)
--   • doctor_hospital_affiliations table
--   • doctors.hospital_id (primary affiliation shortcut)
--   • 'HOSPITAL' role in profiles + admin_set_user_role()
--   • Reuses existing storage buckets: hospital-photos, hospital-docs
--   • Migrates existing APPROVED hospital applications to HOSPITAL role
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. ADD 'HOSPITAL' ROLE TO PROFILES
-- ─────────────────────────────────────────────

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('PATIENT', 'DOCTOR', 'ADMIN', 'HOSPITAL'));

-- Allow admins to assign the HOSPITAL role via the existing RPC
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
    target_user_id UUID,
    new_role TEXT
)
RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'ADMIN'
    ) THEN
        RAISE EXCEPTION 'Only admins can change user roles';
    END IF;

    IF new_role NOT IN ('PATIENT', 'DOCTOR', 'ADMIN', 'HOSPITAL') THEN
        RAISE EXCEPTION 'Invalid role: %', new_role;
    END IF;

    UPDATE public.profiles SET role = new_role, updated_at = NOW()
    WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- 2. HOSPITALS TABLE (first-class hospital accounts)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospitals (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id       UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,

    -- Basic Info
    name                TEXT NOT NULL,
    type                TEXT CHECK (type IN ('GOVERNMENT', 'PRIVATE', 'CLINIC', 'MULTI_SPECIALTY')),
    registration_number TEXT,
    bed_count           INTEGER CHECK (bed_count >= 0),

    -- Address & Location
    address             TEXT,
    city                TEXT,
    state               TEXT,
    pincode             TEXT,
    latitude            DECIMAL(10,8),
    longitude           DECIMAL(11,8),

    -- Contact & Web
    phone               TEXT,
    email               TEXT,
    website             TEXT,

    -- Summary (text + optional uploaded brochure/PDF in hospital-docs bucket)
    summary_text        TEXT,
    summary_doc_url     TEXT,

    -- Cover photo (storage path in hospital-photos bucket)
    cover_photo_url     TEXT,

    -- Flags
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_verified         BOOLEAN NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.hospitals IS
    'First-class hospital accounts (role HOSPITAL). Owners manage their profile, photos, and affiliated doctors.';

CREATE TRIGGER set_hospitals_updated_at
    BEFORE UPDATE ON public.hospitals
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────
-- 3. HOSPITAL PHOTOS TABLE (gallery)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospital_photos (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hospital_id     BIGINT NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
    photo_url       TEXT NOT NULL,                 -- storage path in hospital-photos bucket
    caption         TEXT,
    display_order   INTEGER NOT NULL DEFAULT 0,
    uploaded_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.hospital_photos IS
    'Photo gallery for a hospital. Stored as storage paths in the hospital-photos bucket.';

-- ─────────────────────────────────────────────
-- 4. DOCTOR ↔ HOSPITAL AFFILIATIONS
-- Self-approval flow: requests are APPROVED immediately by default.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doctor_hospital_affiliations (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id       BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    hospital_id     BIGINT NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'APPROVED'
                    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_doctor_hospital UNIQUE (doctor_id, hospital_id)
);

COMMENT ON TABLE public.doctor_hospital_affiliations IS
    'Links doctors to hospitals. Self-approval flow — affiliations are APPROVED on creation.';

-- ─────────────────────────────────────────────
-- 5. ALTER doctors — primary affiliation shortcut
-- ─────────────────────────────────────────────

ALTER TABLE public.doctors
    ADD COLUMN IF NOT EXISTS hospital_id BIGINT
    REFERENCES public.hospitals(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────
-- 6. INDEXES
-- ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_hospitals_owner       ON public.hospitals(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_hospitals_active       ON public.hospitals(is_active);
CREATE INDEX IF NOT EXISTS idx_hospitals_city         ON public.hospitals(city) WHERE city IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hospital_photos_hospital ON public.hospital_photos(hospital_id);

CREATE INDEX IF NOT EXISTS idx_affiliations_doctor    ON public.doctor_hospital_affiliations(doctor_id);
CREATE INDEX IF NOT EXISTS idx_affiliations_hospital  ON public.doctor_hospital_affiliations(hospital_id);
CREATE INDEX IF NOT EXISTS idx_affiliations_status    ON public.doctor_hospital_affiliations(status);

CREATE INDEX IF NOT EXISTS idx_doctors_hospital_id    ON public.doctors(hospital_id) WHERE hospital_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_hospital_affiliations ENABLE ROW LEVEL SECURITY;

-- ── hospitals ──
-- Anyone can read active hospitals (public directory + doctor selector)
CREATE POLICY "hospitals_public_select"
    ON public.hospitals FOR SELECT
    USING (is_active = TRUE OR owner_user_id = auth.uid());

-- Owner can insert their own hospital (admin approval typically creates it, but allow self-create)
CREATE POLICY "hospitals_owner_insert"
    ON public.hospitals FOR INSERT
    WITH CHECK (owner_user_id = auth.uid());

-- Owner can update their own hospital
CREATE POLICY "hospitals_owner_update"
    ON public.hospitals FOR UPDATE
    USING (owner_user_id = auth.uid());

-- Admins can do anything
CREATE POLICY "hospitals_admin_all"
    ON public.hospitals FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- ── hospital_photos ──
-- Public read
CREATE POLICY "hospital_photos_public_select"
    ON public.hospital_photos FOR SELECT
    USING (true);

-- Hospital owner can insert photos for their hospital
CREATE POLICY "hospital_photos_owner_insert"
    ON public.hospital_photos FOR INSERT
    WITH CHECK (
        hospital_id IN (SELECT id FROM public.hospitals WHERE owner_user_id = auth.uid())
    );

-- Hospital owner can update photos for their hospital
CREATE POLICY "hospital_photos_owner_update"
    ON public.hospital_photos FOR UPDATE
    USING (
        hospital_id IN (SELECT id FROM public.hospitals WHERE owner_user_id = auth.uid())
    );

-- Hospital owner can delete photos for their hospital
CREATE POLICY "hospital_photos_owner_delete"
    ON public.hospital_photos FOR DELETE
    USING (
        hospital_id IN (SELECT id FROM public.hospitals WHERE owner_user_id = auth.uid())
    );

-- Admins full access
CREATE POLICY "hospital_photos_admin_all"
    ON public.hospital_photos FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- ── doctor_hospital_affiliations ──
-- Public can read APPROVED affiliations (to list a hospital's doctors / a doctor's hospitals)
CREATE POLICY "affiliations_public_select"
    ON public.doctor_hospital_affiliations FOR SELECT
    USING (
        status = 'APPROVED'
        OR doctor_id IN (SELECT id FROM public.doctors WHERE user_id = auth.uid())
        OR hospital_id IN (SELECT id FROM public.hospitals WHERE owner_user_id = auth.uid())
    );

-- Doctor can create their own affiliation request (self-join)
CREATE POLICY "affiliations_doctor_insert"
    ON public.doctor_hospital_affiliations FOR INSERT
    WITH CHECK (
        doctor_id IN (SELECT id FROM public.doctors WHERE user_id = auth.uid())
    );

-- Doctor can update / leave their own affiliation
CREATE POLICY "affiliations_doctor_update"
    ON public.doctor_hospital_affiliations FOR UPDATE
    USING (
        doctor_id IN (SELECT id FROM public.doctors WHERE user_id = auth.uid())
    );

CREATE POLICY "affiliations_doctor_delete"
    ON public.doctor_hospital_affiliations FOR DELETE
    USING (
        doctor_id IN (SELECT id FROM public.doctors WHERE user_id = auth.uid())
    );

-- Hospital owner can update affiliations to their hospital (e.g. remove a doctor)
CREATE POLICY "affiliations_hospital_update"
    ON public.doctor_hospital_affiliations FOR UPDATE
    USING (
        hospital_id IN (SELECT id FROM public.hospitals WHERE owner_user_id = auth.uid())
    );

CREATE POLICY "affiliations_hospital_delete"
    ON public.doctor_hospital_affiliations FOR DELETE
    USING (
        hospital_id IN (SELECT id FROM public.hospitals WHERE owner_user_id = auth.uid())
    );

-- Admins full access
CREATE POLICY "affiliations_admin_all"
    ON public.doctor_hospital_affiliations FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- ─────────────────────────────────────────────
-- 8. STORAGE — reuse existing buckets
--    hospital-photos (public)  → photos + cover
--    hospital-docs   (private) → summary documents
-- Ensure they exist (created in supabase_hospital_info_migration.sql).
-- ─────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'hospital-photos', 'hospital-photos', TRUE, 2097152,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'hospital-docs', 'hospital-docs', FALSE, 5242880,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────
-- 9. MIGRATE EXISTING APPROVED HOSPITAL APPLICATIONS
--    Previously, approved hospital applications were given the
--    DOCTOR role with no hospital record. Promote them to HOSPITAL
--    and back-fill a hospitals row from the application data.
-- ─────────────────────────────────────────────

-- 9a. Promote role to HOSPITAL
UPDATE public.profiles p
SET role = 'HOSPITAL', updated_at = NOW()
FROM public.collaboration_applications ca
WHERE ca.application_type = 'HOSPITAL'
  AND ca.status = 'APPROVED'
  AND ca.created_user_id = p.id
  AND p.role <> 'HOSPITAL';

-- 9b. Create hospitals rows for migrated users (if not already present)
INSERT INTO public.hospitals (
    owner_user_id, name, type, registration_number, bed_count,
    address, city, state, pincode, is_active, is_verified
)
SELECT
    ca.created_user_id,
    COALESCE(ca.hospital_name, ca.applicant_name),
    ca.hospital_type,
    ca.registration_number,
    ca.bed_count,
    ca.hospital_address,
    ca.hospital_city,
    ca.hospital_state,
    ca.hospital_pincode,
    TRUE,
    TRUE
FROM public.collaboration_applications ca
WHERE ca.application_type = 'HOSPITAL'
  AND ca.status = 'APPROVED'
  AND ca.created_user_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.hospitals h WHERE h.owner_user_id = ca.created_user_id
  );

-- ============================================================
-- DONE! Hospital management schema ready. 🏥
-- ============================================================
