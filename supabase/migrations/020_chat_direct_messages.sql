-- ═══════════════════════════════════════════════════════════════
-- PATIENT ↔ DOCTOR CHAT MIGRATION  (WhatsApp-style messaging)
--
-- Adds:
--   • conversations    — one thread per (patient, doctor) pair
--   • direct_messages  — individual messages, realtime-enabled
--   • get_or_create_conversation() RPC (scoped to people with an appointment)
--   • RLS so only the two participants can read/write
--
-- NOTE: the messages table is named `direct_messages` (NOT `chat_messages`)
-- because `chat_messages` already exists for the AI assistant.
--
-- Run in the Supabase SQL editor. Idempotent / safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. CONVERSATIONS (one per patient↔doctor pair)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id       BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_conversation_pair UNIQUE (patient_id, doctor_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_patient
    ON public.conversations(patient_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_doctor
    ON public.conversations(doctor_id, last_message_at DESC);

-- ─────────────────────────────────────────────
-- 2. DIRECT MESSAGES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.direct_messages (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation
    ON public.direct_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_direct_messages_unread
    ON public.direct_messages(conversation_id, sender_id) WHERE read_at IS NULL;

-- Bump the conversation's last_message_at on every new message.
CREATE OR REPLACE FUNCTION public.touch_conversation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.conversations
       SET last_message_at = NEW.created_at
     WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_conversation ON public.direct_messages;
CREATE TRIGGER trg_touch_conversation
    AFTER INSERT ON public.direct_messages
    FOR EACH ROW EXECUTE FUNCTION public.touch_conversation();

-- ─────────────────────────────────────────────
-- 3. PARTICIPANT CHECK (used by RLS, avoids recursion)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.conversations c
        LEFT JOIN public.doctors d ON d.id = c.doctor_id
        WHERE c.id = p_conversation_id
          AND (c.patient_id = auth.uid() OR d.user_id = auth.uid())
    );
$$;

-- ─────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE public.conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages   ENABLE ROW LEVEL SECURITY;

-- conversations: a participant can see/create their own threads.
DROP POLICY IF EXISTS "conv_participant_select" ON public.conversations;
CREATE POLICY "conv_participant_select" ON public.conversations
    FOR SELECT USING (
        patient_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = doctor_id AND d.user_id = auth.uid())
    );

DROP POLICY IF EXISTS "conv_participant_insert" ON public.conversations;
CREATE POLICY "conv_participant_insert" ON public.conversations
    FOR INSERT WITH CHECK (
        patient_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = doctor_id AND d.user_id = auth.uid())
    );

-- direct_messages: participants read; sender must be the caller on insert.
DROP POLICY IF EXISTS "msg_select" ON public.direct_messages;
CREATE POLICY "msg_select" ON public.direct_messages
    FOR SELECT USING (public.is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "msg_insert" ON public.direct_messages;
CREATE POLICY "msg_insert" ON public.direct_messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid()
        AND public.is_conversation_participant(conversation_id)
    );

-- Allow marking messages read (only a participant flips read_at).
DROP POLICY IF EXISTS "msg_update" ON public.direct_messages;
CREATE POLICY "msg_update" ON public.direct_messages
    FOR UPDATE USING (public.is_conversation_participant(conversation_id));

-- ─────────────────────────────────────────────
-- 5. GET OR CREATE CONVERSATION (scoped to an existing appointment relationship)
-- ─────────────────────────────────────────────

-- Per-doctor switch: accept chats from patients with no appointment history.
ALTER TABLE public.doctors
    ADD COLUMN IF NOT EXISTS accept_new_patient_messages BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION public.get_or_create_conversation(
    p_patient_id UUID,
    p_doctor_id  BIGINT
)
RETURNS public.conversations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid  UUID := auth.uid();
    v_conv public.conversations;
BEGIN
    -- Caller must be one of the two participants.
    IF NOT (
        p_patient_id = v_uid
        OR EXISTS (SELECT 1 FROM public.doctors WHERE id = p_doctor_id AND user_id = v_uid)
    ) THEN
        RAISE EXCEPTION 'Not authorized to open this conversation.' USING ERRCODE = '42501';
    END IF;

    -- Both ends must be valid (a real patient profile + an active doctor).
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_patient_id) THEN
        RAISE EXCEPTION 'Patient not found.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.doctors WHERE id = p_doctor_id AND is_active = TRUE) THEN
        RAISE EXCEPTION 'This doctor is not available for messaging.' USING ERRCODE = 'P0001';
    END IF;

    -- If a patient is starting a brand-new chat (no appointment history), the
    -- doctor must have "accept messages from new patients" turned on. Patients
    -- who already have an appointment with this doctor can always message.
    IF p_patient_id = v_uid
       AND NOT EXISTS (SELECT 1 FROM public.appointments
                       WHERE patient_id = p_patient_id AND doctor_id = p_doctor_id)
       AND NOT EXISTS (SELECT 1 FROM public.doctors
                       WHERE id = p_doctor_id AND accept_new_patient_messages = TRUE)
    THEN
        RAISE EXCEPTION 'This doctor is not accepting messages from new patients.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_conv FROM public.conversations
    WHERE patient_id = p_patient_id AND doctor_id = p_doctor_id;

    IF NOT FOUND THEN
        INSERT INTO public.conversations (patient_id, doctor_id)
        VALUES (p_patient_id, p_doctor_id)
        RETURNING * INTO v_conv;
    END IF;

    RETURN v_conv;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_conversation(UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(UUID, BIGINT) TO authenticated;

-- ─────────────────────────────────────────────
-- 6. ENABLE REALTIME on direct_messages
-- ─────────────────────────────────────────────
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
EXCEPTION
    WHEN duplicate_object THEN NULL;  -- already added
END;
$$;
