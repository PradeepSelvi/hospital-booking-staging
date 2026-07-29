-- ============================================================
-- SECURITY FIX: Hardcode PATIENT role in signup trigger
-- Prevents role escalation via user_metadata manipulation
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Fix the trigger — ALWAYS set role to PATIENT on signup
--    Admin/Doctor roles must be set via direct DB update only
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
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
    -- NOTE: We intentionally DO NOT update role on conflict.
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Add RLS policy to prevent users from changing their own role
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (
        -- Users can update their profile but NOT change their role
        role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    );

-- 4. Backfill any existing users missing profiles
INSERT INTO public.profiles (id, name, email, phone, role)
SELECT
    u.id,
    COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
    u.email,
    COALESCE(u.raw_user_meta_data->>'phone', ''),
    'PATIENT'
FROM auth.users u
WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = u.id
);

-- 5. Add a DB function for admin to safely change roles
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
    target_user_id UUID,
    new_role TEXT
)
RETURNS VOID AS $$
BEGIN
    -- Verify the caller is an admin
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'ADMIN'
    ) THEN
        RAISE EXCEPTION 'Only admins can change user roles';
    END IF;
    
    -- Validate role
    IF new_role NOT IN ('PATIENT', 'DOCTOR', 'ADMIN') THEN
        RAISE EXCEPTION 'Invalid role: %', new_role;
    END IF;
    
    UPDATE public.profiles SET role = new_role, updated_at = NOW()
    WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Verify
SELECT id, name, email, role FROM public.profiles;
