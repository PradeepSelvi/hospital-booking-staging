-- ============================================================
-- MEDIBOOK — ACCOUNT CLOSURE MIGRATION
-- Run in: Supabase SQL Editor
--   AFTER: supabase_migration.sql
--          supabase_hospital_management_migration.sql
-- Version: 1.0.0
--
-- Lets a PATIENT, DOCTOR, or HOSPITAL close their own account.
-- Closure is a secure soft-delete:
--   • profiles.is_active = FALSE  (login is blocked client-side)
--   • the user's doctor / hospital records are deactivated
--   • closed_at / closure_reason are recorded for audit
-- Data is preserved so an admin can reverse it if needed.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. AUDIT COLUMNS ON PROFILES
-- ─────────────────────────────────────────────

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS closed_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closure_reason TEXT;

-- ─────────────────────────────────────────────
-- 2. SELF-SERVICE CLOSURE RPC
--    SECURITY DEFINER so it can atomically deactivate the caller's
--    profile + role records. Every statement is scoped to auth.uid(),
--    so a user can only ever close THEIR OWN account.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.close_my_account(reason TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
    uid UUID := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Deactivate the caller's doctor record (if any)
    UPDATE public.doctors
        SET is_active = FALSE
        WHERE user_id = uid;

    -- Deactivate the caller's hospital record (if any)
    UPDATE public.hospitals
        SET is_active = FALSE
        WHERE owner_user_id = uid;

    -- Mark the profile closed
    UPDATE public.profiles
        SET is_active      = FALSE,
            closed_at      = NOW(),
            closure_reason = LEFT(COALESCE(reason, ''), 500),
            updated_at     = NOW()
        WHERE id = uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow authenticated users to call it (it self-scopes via auth.uid()).
GRANT EXECUTE ON FUNCTION public.close_my_account(TEXT) TO authenticated;

-- ─────────────────────────────────────────────
-- 3. ADMIN REOPEN RPC
--    Lets an admin reactivate a previously closed account WITHOUT any
--    data loss: it flips the profile (and the user's doctor/hospital
--    records) back to active and clears the closure metadata.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reopen_account(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'
    ) THEN
        RAISE EXCEPTION 'Only admins can reopen accounts';
    END IF;

    UPDATE public.profiles
        SET is_active      = TRUE,
            closed_at      = NULL,
            closure_reason = NULL,
            updated_at     = NOW()
        WHERE id = target_user_id;

    UPDATE public.doctors
        SET is_active = TRUE
        WHERE user_id = target_user_id;

    UPDATE public.hospitals
        SET is_active = TRUE
        WHERE owner_user_id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_reopen_account(UUID) TO authenticated;

-- ============================================================
-- DONE! Account closure ready. 🔒
-- ============================================================
