-- ============================================================
-- MEDIBOOK — COMPLAINTS & CONTACT/SUPPORT MIGRATION
-- Run in: Supabase SQL Editor
--   AFTER: supabase_migration.sql
--          supabase_hospital_management_migration.sql
-- Version: 1.0.0
--
-- Adds:
--   • contact_messages  — public feedback / query / contact form
--   • complaints        — role-based complaints & petitions with
--                         admin review + action tracking
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. CONTACT MESSAGES (public feedback / query / contact)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contact_messages (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Optional link to a logged-in user (null for anonymous submissions)
    user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'QUERY'
                CHECK (type IN ('FEEDBACK', 'QUERY', 'CONTACT', 'OTHER')),
    subject     TEXT,
    message     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'NEW'
                CHECK (status IN ('NEW', 'READ', 'RESPONDED', 'CLOSED')),
    admin_notes TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.contact_messages IS
    'Public contact / feedback / query submissions from the home page.';

CREATE INDEX IF NOT EXISTS idx_contact_messages_status  ON public.contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON public.contact_messages(created_at DESC);

-- ─────────────────────────────────────────────
-- 2. COMPLAINTS (role-based, with admin action tracking)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.complaints (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Who filed it
    complainant_user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    complainant_role        TEXT NOT NULL
                            CHECK (complainant_role IN ('PATIENT', 'DOCTOR', 'HOSPITAL')),
    complainant_name        TEXT,          -- denormalized for admin display
    complainant_email       TEXT,

    -- What/who it is against
    target_type             TEXT NOT NULL
                            CHECK (target_type IN ('DOCTOR', 'HOSPITAL', 'PATIENT', 'MANAGEMENT')),
    target_doctor_id        BIGINT REFERENCES public.doctors(id) ON DELETE SET NULL,
    target_hospital_id      BIGINT REFERENCES public.hospitals(id) ON DELETE SET NULL,
    target_patient_user_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    target_name             TEXT,          -- denormalized label for display/audit

    -- Details
    category                TEXT NOT NULL DEFAULT 'OTHER'
                            CHECK (category IN ('BEHAVIOUR', 'PAYMENT', 'SERVICE_QUALITY',
                                                'MISCONDUCT', 'FACILITY', 'NEGLIGENCE',
                                                'MANAGEMENT', 'OTHER')),
    subject                 TEXT NOT NULL,
    description             TEXT NOT NULL,

    -- Review & resolution
    status                  TEXT NOT NULL DEFAULT 'OPEN'
                            CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED',
                                              'REJECTED', 'ACTION_TAKEN')),
    admin_notes             TEXT,
    action_taken            TEXT,          -- description of action e.g. "Doctor deactivated"
    resolved_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at             TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.complaints IS
    'Role-based complaints & petitions. Patients, doctors and hospitals file; admins review and act.';

CREATE TRIGGER set_complaints_updated_at
    BEFORE UPDATE ON public.complaints
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_complaints_complainant ON public.complaints(complainant_user_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status      ON public.complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_target_type ON public.complaints(target_type);
CREATE INDEX IF NOT EXISTS idx_complaints_created     ON public.complaints(created_at DESC);

-- ─────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints       ENABLE ROW LEVEL SECURITY;

-- ── contact_messages ──
-- Anyone (including anonymous) may submit a message.
CREATE POLICY "contact_public_insert"
    ON public.contact_messages FOR INSERT
    WITH CHECK (true);

-- Only admins can read/manage submitted messages.
CREATE POLICY "contact_admin_select"
    ON public.contact_messages FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

CREATE POLICY "contact_admin_update"
    ON public.contact_messages FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- ── complaints ──
-- A logged-in user can file a complaint as themselves.
CREATE POLICY "complaints_owner_insert"
    ON public.complaints FOR INSERT
    WITH CHECK (complainant_user_id = auth.uid());

-- Complainant can read (track) their own complaints; admins read all.
CREATE POLICY "complaints_owner_select"
    ON public.complaints FOR SELECT
    USING (
        complainant_user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
    );

-- Only admins can update (review / resolve / record actions).
CREATE POLICY "complaints_admin_update"
    ON public.complaints FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- Admins full access.
CREATE POLICY "complaints_admin_all"
    ON public.complaints FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- ============================================================
-- DONE! Complaints & contact/support schema ready. 📨
-- ============================================================
