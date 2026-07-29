-- ═══════════════════════════════════════════════════════════════
-- ADMIN REPORTS — server-side aggregation
--
-- A single admin-only, SECURITY DEFINER function that returns a full analytics
-- payload for a date range as JSON. Aggregating on the server:
--   • is faster than shipping every row to the browser,
--   • ships only aggregates + public doctor names (no patient PII), and
--   • is access-controlled in one place (is_admin() check).
--
-- Sections: appointment counts by status, revenue (from payments), a daily
-- trend, top doctors, geographic distribution by hospital city, and new-user
-- counts.
--
-- Idempotent. Depends on: 001 (appointments/doctors/profiles), 007 (hospitals,
-- doctors.hospital_id), 022 (payments), 024 (is_admin()).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_report_overview(
    p_from DATE,
    p_to   DATE
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can view reports.' USING ERRCODE = '42501';
    END IF;

    -- Guard the range: default + clamp span to 2 years to bound the work.
    p_from := COALESCE(p_from, CURRENT_DATE - INTERVAL '30 days');
    p_to   := COALESCE(p_to, CURRENT_DATE);
    IF p_to < p_from THEN
        RAISE EXCEPTION 'End date must be on or after start date.' USING ERRCODE = 'P0001';
    END IF;
    IF p_to - p_from > 731 THEN
        RAISE EXCEPTION 'Date range too large (max 2 years).' USING ERRCODE = 'P0001';
    END IF;

    SELECT json_build_object(
        'range', json_build_object('from', p_from, 'to', p_to),

        -- ── Appointments in range (by appointment_date) ──
        'appointments', (
            SELECT json_build_object(
                'total',      COUNT(*),
                'pending',    COUNT(*) FILTER (WHERE status = 'PENDING'),
                'confirmed',  COUNT(*) FILTER (WHERE status = 'CONFIRMED'),
                'completed',  COUNT(*) FILTER (WHERE status = 'COMPLETED'),
                'cancelled',  COUNT(*) FILTER (WHERE status = 'CANCELLED')
            )
            FROM public.appointments
            WHERE appointment_date BETWEEN p_from AND p_to
        ),

        -- ── Revenue (payments settled in range, by paid_at) ──
        'revenue', (
            SELECT json_build_object(
                'collected_paise', COALESCE(SUM(amount_paise) FILTER (WHERE status = 'PAID'), 0),
                'pending_paise',   COALESCE(SUM(amount_paise) FILTER (WHERE status = 'PENDING'), 0),
                'refunded_paise',  COALESCE(SUM(amount_paise) FILTER (WHERE status = 'REFUNDED'), 0),
                'paid_count',      COUNT(*) FILTER (WHERE status = 'PAID'),
                'online_count',    COUNT(*) FILTER (WHERE status = 'PAID' AND method = 'ONLINE'),
                'offline_count',   COUNT(*) FILTER (WHERE status = 'PAID' AND method = 'OFFLINE')
            )
            FROM public.payments
            WHERE COALESCE(paid_at::DATE, requested_at::DATE) BETWEEN p_from AND p_to
        ),

        -- ── Daily trend ──
        'daily', (
            SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.day), '[]'::json)
            FROM (
                SELECT
                    d::DATE AS day,
                    (SELECT COUNT(*) FROM public.appointments a
                       WHERE a.appointment_date = d::DATE) AS total,
                    (SELECT COUNT(*) FROM public.appointments a
                       WHERE a.appointment_date = d::DATE AND a.status = 'COMPLETED') AS completed,
                    (SELECT COUNT(*) FROM public.appointments a
                       WHERE a.appointment_date = d::DATE AND a.status = 'CANCELLED') AS cancelled,
                    (SELECT COALESCE(SUM(p.amount_paise), 0) FROM public.payments p
                       WHERE p.status = 'PAID' AND p.paid_at::DATE = d::DATE) AS revenue_paise
                FROM generate_series(p_from, p_to, INTERVAL '1 day') d
            ) t
        ),

        -- ── Top doctors by appointment volume in range ──
        'top_doctors', (
            SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.total DESC), '[]'::json)
            FROM (
                SELECT
                    pr.name AS name,
                    d.specialization AS specialization,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE a.status = 'COMPLETED') AS completed,
                    COUNT(*) FILTER (WHERE a.status = 'CANCELLED') AS cancelled
                FROM public.appointments a
                JOIN public.doctors d ON d.id = a.doctor_id
                JOIN public.profiles pr ON pr.id = d.user_id
                WHERE a.appointment_date BETWEEN p_from AND p_to
                GROUP BY pr.name, d.specialization
                ORDER BY total DESC
                LIMIT 10
            ) t
        ),

        -- ── Geographic distribution (by hospital city) ──
        'by_city', (
            SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.appointments DESC), '[]'::json)
            FROM (
                SELECT
                    COALESCE(h.city, 'Unknown') AS city,
                    COUNT(a.id) AS appointments
                FROM public.appointments a
                JOIN public.doctors d ON d.id = a.doctor_id
                LEFT JOIN public.hospitals h ON h.id = d.hospital_id
                WHERE a.appointment_date BETWEEN p_from AND p_to
                GROUP BY COALESCE(h.city, 'Unknown')
                ORDER BY appointments DESC
                LIMIT 25
            ) t
        ),

        -- ── New users registered in range ──
        'new_users', (
            SELECT json_build_object(
                'patients',  COUNT(*) FILTER (WHERE role = 'PATIENT'),
                'doctors',   COUNT(*) FILTER (WHERE role = 'DOCTOR'),
                'hospitals', COUNT(*) FILTER (WHERE role = 'HOSPITAL')
            )
            FROM public.profiles
            WHERE created_at::DATE BETWEEN p_from AND p_to
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_overview(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_report_overview(DATE, DATE) TO authenticated;
