-- ═══════════════════════════════════════════════════════════════
-- PROFILES PII — LEAST-PRIVILEGE READ POLICIES
--
-- Problem: `profiles_select USING (true)` (from 001) makes EVERY profile row —
-- including email and phone — readable by anyone holding the public anon key,
-- even unauthenticated. That is a PII leak for a healthcare app.
--
-- Fix: replace the blanket policy with granular SELECT policies that preserve
-- every existing read path while hiding patient PII from strangers.
--
-- Read paths that MUST keep working (verified against the app):
--   • A user reads their own profile.                         → self
--   • Admin console lists/reads all users.                    → admin
--   • Public directory (/doctors, /doctors/:id, landing) shows
--     doctor names/photos to anonymous visitors.              → doctor public
--   • Hospital directory shows hospital-owner names.          → hospital public
--   • A doctor sees the name/phone/email of patients they have
--     an appointment or conversation with (dashboards, chat). → doctor↔patient
--
-- ⚠️ RECURSION SAFETY (critical):
--   A policy ON profiles must not, directly or indirectly, evaluate RLS on a
--   table whose OWN policies read profiles. `doctors`, `appointments`,
--   `hospitals` and `conversations` all have policies that read profiles, so a
--   plain `EXISTS (SELECT ... FROM doctors ...)` inside a profiles policy sets
--   up a mutual cycle → Postgres raises "infinite recursion detected in policy
--   for relation profiles" and EVERY profile read fails.
--
--   Therefore every cross-table check below is wrapped in a SECURITY DEFINER
--   helper. A definer function runs as its owner and BYPASSES RLS on the tables
--   it reads, which breaks the cycle. The helpers never read profiles (except
--   is_admin(), which is itself definer and so does not recurse).
--
-- Idempotent / safe to re-run. Depends on: 001 (profiles), 007 (hospitals),
-- 017/001 (appointments), 020 (conversations).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. SECURITY DEFINER helpers (bypass RLS internally → recursion-safe)
-- ─────────────────────────────────────────────

-- Is the caller an ADMIN?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'ADMIN'
    );
$$;

-- Does this profile belong to a doctor? (public directory)
CREATE OR REPLACE FUNCTION public.profile_is_doctor(p_profile UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.doctors d WHERE d.user_id = p_profile);
$$;

-- Does this profile own a hospital? (public directory)
CREATE OR REPLACE FUNCTION public.profile_is_hospital_owner(p_profile UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.hospitals h WHERE h.owner_user_id = p_profile);
$$;

-- Does the CALLER (a doctor) have an appointment with this patient profile?
CREATE OR REPLACE FUNCTION public.caller_treats_patient(p_patient UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.appointments a
        JOIN public.doctors d ON d.id = a.doctor_id
        WHERE d.user_id = auth.uid()
          AND a.patient_id = p_patient
    );
$$;

-- Does the CALLER (a doctor) share a conversation with this patient profile?
CREATE OR REPLACE FUNCTION public.caller_converses_patient(p_patient UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.conversations c
        JOIN public.doctors d ON d.id = c.doctor_id
        WHERE d.user_id = auth.uid()
          AND c.patient_id = p_patient
    );
$$;

DO $$
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.profile_is_doctor(UUID) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.profile_is_hospital_owner(UUID) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.caller_treats_patient(UUID) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.caller_converses_patient(UUID) FROM PUBLIC';
END $$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_is_doctor(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_is_hospital_owner(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caller_treats_patient(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caller_converses_patient(UUID) TO anon, authenticated;

-- ─────────────────────────────────────────────
-- 2. Privacy-preserving email existence check for the PUBLIC collaboration
--    form. Returns a boolean only (no row data).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_has_account(p_email TEXT)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE lower(email) = lower(trim(p_email))
    );
$$;

REVOKE ALL ON FUNCTION public.email_has_account(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_has_account(TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────
-- 3. Replace the world-readable SELECT policy with least-privilege policies.
--    (Multiple SELECT policies are OR-combined by Postgres.)
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

-- 3.1 Own profile.
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
CREATE POLICY "profiles_select_self" ON public.profiles
    FOR SELECT USING (id = auth.uid());

-- 3.2 Admins read everything.
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_admin" ON public.profiles
    FOR SELECT USING (public.is_admin());

-- 3.3 Doctor profiles are public (directory shows name/photo to anon).
DROP POLICY IF EXISTS "profiles_select_doctor_public" ON public.profiles;
CREATE POLICY "profiles_select_doctor_public" ON public.profiles
    FOR SELECT USING (public.profile_is_doctor(id));

-- 3.4 Hospital-owner profiles are public.
DROP POLICY IF EXISTS "profiles_select_hospital_public" ON public.profiles;
CREATE POLICY "profiles_select_hospital_public" ON public.profiles
    FOR SELECT USING (public.profile_is_hospital_owner(id));

-- 3.5 A doctor may read profiles of patients they have an appointment with.
DROP POLICY IF EXISTS "profiles_select_doctor_patient" ON public.profiles;
CREATE POLICY "profiles_select_doctor_patient" ON public.profiles
    FOR SELECT USING (public.caller_treats_patient(id));

-- 3.6 A doctor may read profiles of patients they share a conversation with.
DROP POLICY IF EXISTS "profiles_select_doctor_convo" ON public.profiles;
CREATE POLICY "profiles_select_doctor_convo" ON public.profiles
    FOR SELECT USING (public.caller_converses_patient(id));
