-- ============================================================
-- SECURE & SCOPED access to collaboration application documents
--
-- Goal: ONLY the admin and the document owner (the applicant) can
--       open a submitted document.
--
-- Design:
--   • The 'collaborate-docs' bucket stays PRIVATE and admin-only at
--     the storage RLS level (collab_docs_admin_read).
--   • Admins view documents directly (they hold the admin read policy).
--   • Anonymous applicants on the public Application Status page cannot
--     read storage directly. Instead, the 'collab-document' Edge Function
--     verifies ownership (email + application ID must match the row, OR
--     the caller is an authenticated ADMIN) and signs a short-lived URL
--     using the service role.
--
-- This file ensures NO broad/public read policy exists on the bucket.
-- (If you previously ran a version that added "collab_docs_public_read",
--  this removes it.)
--
-- Run in: Supabase SQL Editor.
-- ============================================================

-- Remove any broad public-read policy that may have been added earlier.
DROP POLICY IF EXISTS "collab_docs_public_read" ON storage.objects;

-- Ensure the admin-only read policy exists (idempotent).
DROP POLICY IF EXISTS "collab_docs_admin_read" ON storage.objects;
CREATE POLICY "collab_docs_admin_read"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'collaborate-docs'
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

-- ============================================================
-- DEPLOY THE EDGE FUNCTION (run in your terminal, not here):
--   supabase functions deploy collab-document
--
-- It uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which are
-- provided automatically in the Supabase Edge runtime.
-- ============================================================

-- VERIFICATION
-- SELECT policyname, cmd, roles
-- FROM pg_policies
-- WHERE tablename = 'objects' AND schemaname = 'storage'
--   AND policyname LIKE 'collab_docs%';
