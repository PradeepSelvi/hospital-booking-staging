-- ═══════════════════════════════════════════════════════════════
-- AUTH HARDENING
--
-- Tightens two authentication-related weaknesses without changing app
-- behaviour. Safe to re-run (idempotent).
--
--   1. profiles INSERT policy was `WITH CHECK (true)` — any authenticated
--      caller could insert a profiles row for an ARBITRARY user id (e.g. one
--      with no profile yet) and pick its role. Restrict inserts to the caller's
--      own id. Normal signup is unaffected: the profile row is created by the
--      SECURITY DEFINER trigger `handle_new_user` (which bypasses RLS), and the
--      client-side self-registration upsert only ever writes id = auth.uid().
--
--   2. SECURITY DEFINER functions ran without a pinned `search_path`, which is
--      a privilege-escalation vector (a caller can prepend a schema and shadow
--      built-ins/tables the definer function resolves unqualified). Pin
--      search_path = public on both definer functions. Behaviour is identical.
--
-- NOTE (not fixed here — needs a design decision): `profiles_select USING (true)`
-- makes EVERY profile (incl. email + phone) world-readable via the public anon
-- key. Restricting it safely requires adding self/admin/doctor-patient read
-- policies so doctor/patient name display and the admin console keep working.
-- Tracked separately.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Restrict profile inserts to the caller's own id
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles
    FOR INSERT
    WITH CHECK (id = auth.uid());

-- ─────────────────────────────────────────────
-- 2a. Pin search_path on the signup trigger function.
--     Keeps role hardcoded to PATIENT (never trust client metadata).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, name, email, phone, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'phone', ''),
        'PATIENT'  -- ALWAYS PATIENT. Never trust client-provided role.
    )
    ON CONFLICT (id) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, public.profiles.name),
        email = EXCLUDED.email,
        updated_at = NOW();
    -- Intentionally DO NOT update role on conflict.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────
-- 2b. Pin search_path on the admin role-setter (SECURITY DEFINER).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
    target_user_id UUID,
    new_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Caller must be an admin.
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
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, TEXT) TO authenticated;
