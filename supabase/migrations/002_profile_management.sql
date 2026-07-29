-- ============================================================
-- MEDIBOOK — PROFILE MANAGEMENT MIGRATION
-- Run in: Supabase SQL Editor
-- Version: 2.0.0
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. STORAGE BUCKET FOR AVATARS
-- ─────────────────────────────────────────────

-- Create public bucket for avatars
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    TRUE,
    524288,  -- 512KB max
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload their own avatar
CREATE POLICY "avatar_upload" ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::TEXT
    );

-- Allow authenticated users to update their own avatar
CREATE POLICY "avatar_update" ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::TEXT
    );

-- Allow authenticated users to delete their own avatar
CREATE POLICY "avatar_delete" ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::TEXT
    );

-- Allow public read access to all avatars
CREATE POLICY "avatar_public_read" ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'avatars');


-- ─────────────────────────────────────────────
-- 2. EXTEND PROFILES TABLE
-- ─────────────────────────────────────────────

-- Add bio field for all users
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS bio TEXT;

-- Add date_of_birth for unified access
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Add gender to profiles
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS gender TEXT
    CHECK (gender IN ('MALE', 'FEMALE', 'OTHER'));


-- ─────────────────────────────────────────────
-- 3. EXTEND DOCTORS TABLE
-- ─────────────────────────────────────────────

-- Languages spoken
ALTER TABLE public.doctors
    ADD COLUMN IF NOT EXISTS languages TEXT[];

-- Medical council registration number
ALTER TABLE public.doctors
    ADD COLUMN IF NOT EXISTS registration_number TEXT;

-- Doctor availability status (visible to patients)
ALTER TABLE public.doctors
    ADD COLUMN IF NOT EXISTS availability_status TEXT
    NOT NULL DEFAULT 'AVAILABLE'
    CHECK (availability_status IN ('AVAILABLE', 'OFFLINE', 'UNAVAILABLE', 'NOT_IN_SERVICE'));


-- ─────────────────────────────────────────────
-- 4. FIX PATIENTS TABLE RLS
-- ─────────────────────────────────────────────

-- Patients need to be able to INSERT their own record
-- (Registration only creates profiles row, not patients row)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'patients'
        AND policyname = 'patients_insert_own'
    ) THEN
        -- Policy already defined in main migration, skip
        NULL;
    END IF;
END $$;

-- Admin can view all patients
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'patients'
        AND policyname = 'patients_admin_update'
    ) THEN
        CREATE POLICY "patients_admin_update" ON public.patients FOR UPDATE
            USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));
    END IF;
END $$;


-- ─────────────────────────────────────────────
-- 5. ADMIN PROFILE UPDATE POLICY
-- ─────────────────────────────────────────────

-- Allow admins to update any profile
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'profiles'
        AND policyname = 'profiles_admin_update'
    ) THEN
        CREATE POLICY "profiles_admin_update" ON public.profiles FOR UPDATE
            USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));
    END IF;
END $$;


-- ─────────────────────────────────────────────
-- 6. INDEXES FOR NEW COLUMNS
-- ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_doctors_registration ON public.doctors(registration_number) WHERE registration_number IS NOT NULL;


-- ============================================================
-- DONE! Profile management schema ready. 🎉
-- Run this AFTER the main supabase_migration.sql
-- ============================================================
