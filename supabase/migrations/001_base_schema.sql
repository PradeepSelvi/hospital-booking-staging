-- ============================================================
-- MEDIBOOK DATABASE SCHEMA
-- Supabase (PostgreSQL) — Industrial Grade
-- Version: 1.0.0
-- Run in: Supabase SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. EXTENSIONS
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- 3. TABLES
-- ─────────────────────────────────────────────

-- 3.1 Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    phone       TEXT,
    role        TEXT NOT NULL DEFAULT 'PATIENT'
                CHECK (role IN ('PATIENT', 'DOCTOR', 'ADMIN')),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS 'User profiles extending Supabase auth. 1:1 with auth.users.';

-- 3.2 Departments
CREATE TABLE IF NOT EXISTS public.departments (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    code        TEXT UNIQUE NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.3 Doctors
CREATE TABLE IF NOT EXISTS public.doctors (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    specialization    TEXT NOT NULL,
    qualification     TEXT,
    experience_years  INTEGER NOT NULL DEFAULT 0 CHECK (experience_years >= 0),
    consultation_fee  DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (consultation_fee >= 0),
    department_id     BIGINT REFERENCES public.departments(id) ON DELETE SET NULL,
    photo_url         TEXT,
    bio               TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.4 Patients
CREATE TABLE IF NOT EXISTS public.patients (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    dob               DATE,
    gender            TEXT CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
    blood_group       TEXT CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    address           TEXT,
    emergency_contact TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.5 Doctor Availability
CREATE TABLE IF NOT EXISTS public.doctor_availability (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id          BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    day_of_week        TEXT NOT NULL CHECK (day_of_week IN ('MON','TUE','WED','THU','FRI','SAT','SUN')),
    start_time         TIME NOT NULL,
    end_time           TIME NOT NULL,
    slot_duration_mins INTEGER NOT NULL DEFAULT 30 CHECK (slot_duration_mins BETWEEN 5 AND 120),
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_doctor_day UNIQUE (doctor_id, day_of_week),
    CONSTRAINT chk_time_range CHECK (end_time > start_time)
);

-- 3.6 Appointments
CREATE TABLE IF NOT EXISTS public.appointments (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id         BIGINT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    appointment_date  DATE NOT NULL,
    slot_start_time   TIME NOT NULL,
    slot_end_time     TIME NOT NULL,
    status            TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED')),
    reason            TEXT,
    cancel_reason     TEXT,
    cancelled_by      TEXT CHECK (cancelled_by IN ('PATIENT', 'DOCTOR', 'ADMIN')),
    booked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_slot_range CHECK (slot_end_time > slot_start_time),
    CONSTRAINT chk_date CHECK (appointment_date >= '2024-01-01')
);

-- 3.7 Notification Logs
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id  BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
    patient_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    doctor_id       BIGINT REFERENCES public.doctors(id) ON DELETE SET NULL,
    type            TEXT NOT NULL CHECK (type IN ('EMAIL', 'SMS')),
    event           TEXT NOT NULL CHECK (event IN (
                      'BOOKING_CONFIRMED', 'REMINDER_24H', 'REMINDER_1H',
                      'CANCELLATION', 'COMPLETION', 'PASSWORD_RESET'
                    )),
    recipient       TEXT NOT NULL,
    message_body    TEXT,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    sent_at         TIMESTAMPTZ,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 4. PERFORMANCE INDEXES
-- ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

CREATE INDEX IF NOT EXISTS idx_doctors_user_id ON public.doctors(user_id);
CREATE INDEX IF NOT EXISTS idx_doctors_specialization ON public.doctors(specialization);
CREATE INDEX IF NOT EXISTS idx_doctors_department ON public.doctors(department_id);
CREATE INDEX IF NOT EXISTS idx_doctors_active ON public.doctors(is_active);
CREATE INDEX IF NOT EXISTS idx_doctors_active_spec ON public.doctors(is_active, specialization);

CREATE INDEX IF NOT EXISTS idx_availability_doctor ON public.doctor_availability(doctor_id);
CREATE INDEX IF NOT EXISTS idx_availability_doctor_day ON public.doctor_availability(doctor_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_appointments_patient ON public.appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON public.appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON public.appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON public.appointments(doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date_status ON public.appointments(doctor_id, appointment_date, status);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_date ON public.appointments(patient_id, appointment_date DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_appointment ON public.notification_logs(appointment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notifications_patient ON public.notification_logs(patient_id);

-- ─────────────────────────────────────────────
-- 5. FUNCTIONS & TRIGGERS
-- ─────────────────────────────────────────────

-- 5.1 Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_doctors_updated_at
    BEFORE UPDATE ON public.doctors
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_patients_updated_at
    BEFORE UPDATE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_appointments_updated_at
    BEFORE UPDATE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5.2 Auto-create profile on auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, name, email, phone, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'phone', ''),
        COALESCE(NEW.raw_user_meta_data->>'role', 'PATIENT')
    )
    ON CONFLICT (id) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, public.profiles.name),
        email = EXCLUDED.email,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5.3 Slot availability check function
CREATE OR REPLACE FUNCTION public.check_slot_available(
    p_doctor_id BIGINT,
    p_date DATE,
    p_start_time TIME
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN NOT EXISTS (
        SELECT 1 FROM public.appointments
        WHERE doctor_id = p_doctor_id
          AND appointment_date = p_date
          AND slot_start_time = p_start_time
          AND status IN ('PENDING', 'CONFIRMED')
    );
END;
$$ LANGUAGE plpgsql;

-- 5.4 Partial unique index (allows rebooking cancelled slots)
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_slot
    ON public.appointments(doctor_id, appointment_date, slot_start_time)
    WHERE status IN ('PENDING', 'CONFIRMED');

-- ─────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK (true);

-- Departments
CREATE POLICY "departments_select" ON public.departments FOR SELECT USING (true);
CREATE POLICY "departments_admin" ON public.departments FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- Doctors
CREATE POLICY "doctors_select" ON public.doctors FOR SELECT USING (true);
CREATE POLICY "doctors_update_own" ON public.doctors FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "doctors_admin" ON public.doctors FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));
CREATE POLICY "doctors_insert" ON public.doctors FOR INSERT WITH CHECK (true);

-- Patients
CREATE POLICY "patients_select_own" ON public.patients FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "patients_update_own" ON public.patients FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "patients_insert_own" ON public.patients FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "patients_admin_select" ON public.patients FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- Doctor Availability
CREATE POLICY "availability_select" ON public.doctor_availability FOR SELECT USING (true);
CREATE POLICY "availability_doctor" ON public.doctor_availability FOR ALL
    USING (EXISTS (SELECT 1 FROM public.doctors WHERE id = doctor_id AND user_id = auth.uid()));
CREATE POLICY "availability_admin" ON public.doctor_availability FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- Appointments
CREATE POLICY "appointments_patient_select" ON public.appointments FOR SELECT USING (patient_id = auth.uid());
CREATE POLICY "appointments_doctor_select" ON public.appointments FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.doctors WHERE id = doctor_id AND user_id = auth.uid()));
CREATE POLICY "appointments_admin_all" ON public.appointments FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));
CREATE POLICY "appointments_patient_insert" ON public.appointments FOR INSERT WITH CHECK (patient_id = auth.uid());
CREATE POLICY "appointments_patient_update" ON public.appointments FOR UPDATE USING (patient_id = auth.uid());
CREATE POLICY "appointments_doctor_update" ON public.appointments FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.doctors WHERE id = doctor_id AND user_id = auth.uid()));

-- Notification Logs
CREATE POLICY "notifications_admin" ON public.notification_logs FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));
CREATE POLICY "notifications_patient" ON public.notification_logs FOR SELECT USING (patient_id = auth.uid());
CREATE POLICY "notifications_insert" ON public.notification_logs FOR INSERT WITH CHECK (true);

-- ─────────────────────────────────────────────
-- 7. SEED DATA
-- ─────────────────────────────────────────────

INSERT INTO public.departments (name, code, description) VALUES
    ('Cardiology',         'CARD',  'Heart and cardiovascular system'),
    ('Neurology',          'NEUR',  'Brain and nervous system'),
    ('Orthopedics',        'ORTH',  'Bones, joints, and musculoskeletal system'),
    ('Pediatrics',         'PEDI',  'Child and adolescent healthcare'),
    ('Dermatology',        'DERM',  'Skin, hair, and nail conditions'),
    ('Gynecology',         'GYNE',  'Women reproductive health'),
    ('Ophthalmology',      'OPHT',  'Eye care and vision'),
    ('ENT',                'ENTT',  'Ear, nose, and throat'),
    ('General Medicine',   'GENM',  'General healthcare and primary care'),
    ('Psychiatry',         'PSYC',  'Mental health and behavioral disorders'),
    ('Urology',            'UROL',  'Urinary tract and male reproductive system'),
    ('Oncology',           'ONCO',  'Cancer diagnosis and treatment'),
    ('Gastroenterology',   'GAST',  'Digestive system disorders'),
    ('Pulmonology',        'PULM',  'Lung and respiratory system'),
    ('Endocrinology',      'ENDO',  'Hormonal and metabolic disorders')
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- 8. VIEWS
-- ─────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_doctor_directory AS
SELECT
    d.id, p.name AS doctor_name, p.email, p.phone,
    d.specialization, d.qualification, d.experience_years,
    d.consultation_fee, d.photo_url, d.bio,
    dep.name AS department_name, dep.code AS department_code,
    d.is_active
FROM public.doctors d
JOIN public.profiles p ON p.id = d.user_id
LEFT JOIN public.departments dep ON dep.id = d.department_id
WHERE d.is_active = TRUE AND p.is_active = TRUE;

CREATE OR REPLACE VIEW public.v_today_appointments AS
SELECT
    a.*, p.name AS patient_name, p.phone AS patient_phone,
    p.email AS patient_email, d.specialization,
    dp.name AS doctor_name
FROM public.appointments a
JOIN public.profiles p ON p.id = a.patient_id
JOIN public.doctors d ON d.id = a.doctor_id
JOIN public.profiles dp ON dp.id = d.user_id
WHERE a.appointment_date = CURRENT_DATE
ORDER BY a.slot_start_time;

-- ============================================================
-- DONE! Schema ready. 🎉
-- ============================================================
