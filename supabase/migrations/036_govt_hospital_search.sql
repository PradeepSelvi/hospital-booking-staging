-- ============================================================
-- MEDIBOOK — GOVERNMENT HOSPITAL DIRECTORY SEARCH MIGRATION
-- Run in: Supabase SQL Editor
-- Version: 1.0.0
--
-- Adds public, read-only search over the existing `hospital_dicnory`
-- table (a national government-hospital directory).
--
-- The raw table stores everything as free text with these quirks:
--   • "0" (and blank) is used as a NULL sentinel across most columns.
--   • `Location_Coordinates` is a single "lat, lng" string.
--   • `Specialties` / `Facilities` are comma / newline separated lists.
--   • Numeric-ish columns (beds, doctors, year) are stored as text.
--
-- This migration is NON-DESTRUCTIVE — it never modifies existing rows.
-- It exposes:
--   1. RLS + public SELECT policy (data is public government info)
--   2. A cleaning helper `medi_null0(text)`
--   3. A normalized view `govt_hospitals_v` (parsed coords, cleaned fields)
--   4. Trigram + btree indexes for fast name / location filtering
--   5. RPCs: search_govt_hospitals(), govt_hospitals_near(),
--            govt_hospital_filter_options()
-- ============================================================

-- ─────────────────────────────────────────────
-- 0. EXTENSIONS
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────────
-- 1. RLS — public read-only access
--    (government hospital directory = public information)
-- ─────────────────────────────────────────────
ALTER TABLE public.hospital_dicnory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "govt_hospitals_public_read" ON public.hospital_dicnory;
CREATE POLICY "govt_hospitals_public_read"
    ON public.hospital_dicnory
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ─────────────────────────────────────────────
-- 2. CLEANING HELPER — "0"/blank sentinel → NULL
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.medi_null0(v text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(NULLIF(btrim(COALESCE(v, '')), ''), '0');
$$;

-- ─────────────────────────────────────────────
-- 3. NORMALIZED VIEW
--    Parses coordinates, cleans "0" sentinels, snake_cases columns.
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.govt_hospitals_v
WITH (security_invoker = true)
AS
SELECT
    -- Every source column is cast to text before cleaning, since some columns
    -- in the raw table are stored as numeric types (e.g. "Subtown" is bigint).
    h."Sr_No"::text                                              AS sr_no,
    public.medi_null0(h."Hospital_Name"::text)                  AS name,
    public.medi_null0(h."State"::text)                          AS state,
    public.medi_null0(h."District"::text)                       AS district,
    public.medi_null0(h."Subdistrict"::text)                    AS subdistrict,
    public.medi_null0(h."Town"::text)                           AS town,
    public.medi_null0(h."Subtown"::text)                        AS subtown,
    public.medi_null0(h."Village"::text)                        AS village,
    public.medi_null0(h."Pincode"::text)                        AS pincode,
    public.medi_null0(h."Location"::text)                       AS location,
    public.medi_null0(h."Address_Original_First_Line"::text)    AS address,
    public.medi_null0(h."Hospital_Category"::text)              AS category,
    public.medi_null0(h."Hospital_Care_Type"::text)             AS care_type,
    public.medi_null0(h."Discipline_Systems_of_Medicine"::text) AS discipline,
    public.medi_null0(h."Specialties"::text)                    AS specialties,
    public.medi_null0(h."Facilities"::text)                     AS facilities,
    public.medi_null0(h."Telephone"::text)                      AS telephone,
    public.medi_null0(h."Mobile_Number"::text)                  AS mobile,
    public.medi_null0(h."Emergency_Num"::text)                  AS emergency,
    public.medi_null0(h."Ambulance_Phone_No"::text)             AS ambulance,
    public.medi_null0(h."Website"::text)                        AS website,
    -- numeric-ish fields (text in source): strip non-digits, blank/0 → NULL.
    -- Cast to text first so the migration is safe whether the source column is
    -- stored as text or numeric. Only accept a sane digit-length so a stray
    -- phone number in a dirty row can't overflow int4 → treated as NULL.
    CASE WHEN regexp_replace(COALESCE(h."Total_Num_Beds"::text, ''), '\D', '', 'g') ~ '^\d{1,7}$'
         THEN NULLIF(regexp_replace(COALESCE(h."Total_Num_Beds"::text, ''), '\D', '', 'g')::int, 0) END AS total_beds,
    CASE WHEN regexp_replace(COALESCE(h."Number_Doctor"::text, ''), '\D', '', 'g') ~ '^\d{1,7}$'
         THEN NULLIF(regexp_replace(COALESCE(h."Number_Doctor"::text, ''), '\D', '', 'g')::int, 0) END AS num_doctors,
    CASE WHEN regexp_replace(COALESCE(h."Establised_Year"::text, ''), '\D', '', 'g') ~ '^\d{1,4}$'
         THEN NULLIF(regexp_replace(COALESCE(h."Establised_Year"::text, ''), '\D', '', 'g')::int, 0) END AS established_year,
    -- "lat, lng" → numeric parts (only when the string is two valid numbers)
    CASE WHEN btrim(COALESCE(h."Location_Coordinates"::text, '')) ~ '^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$'
         THEN btrim(split_part(h."Location_Coordinates"::text, ',', 1))::double precision END AS latitude,
    CASE WHEN btrim(COALESCE(h."Location_Coordinates"::text, '')) ~ '^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$'
         THEN btrim(split_part(h."Location_Coordinates"::text, ',', 2))::double precision END AS longitude
FROM public.hospital_dicnory h;

GRANT SELECT ON public.govt_hospitals_v TO anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. INDEXES (on the base table's raw columns)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_govt_name_trgm
    ON public.hospital_dicnory USING gin ("Hospital_Name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_govt_state
    ON public.hospital_dicnory ("State");
CREATE INDEX IF NOT EXISTS idx_govt_district
    ON public.hospital_dicnory ("District");
CREATE INDEX IF NOT EXISTS idx_govt_pincode
    ON public.hospital_dicnory ("Pincode");
CREATE INDEX IF NOT EXISTS idx_govt_specialties_trgm
    ON public.hospital_dicnory USING gin ("Specialties" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_govt_facilities_trgm
    ON public.hospital_dicnory USING gin ("Facilities" gin_trgm_ops);

-- ─────────────────────────────────────────────
-- 5. RPC — paginated text/filter search
--    Returns matching rows + a window total_count for pagination.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_govt_hospitals(
    p_search      text DEFAULT NULL,
    p_state       text DEFAULT NULL,
    p_district    text DEFAULT NULL,
    p_subdistrict text DEFAULT NULL,
    p_pincode     text DEFAULT NULL,
    p_care_type   text DEFAULT NULL,
    p_discipline  text DEFAULT NULL,
    p_specialty   text DEFAULT NULL,
    p_facility    text DEFAULT NULL,
    p_min_beds    int  DEFAULT NULL,
    p_limit       int  DEFAULT 20,
    p_offset      int  DEFAULT 0
)
RETURNS TABLE (
    sr_no           text,
    name            text,
    state           text,
    district        text,
    subdistrict     text,
    town            text,
    subtown         text,
    village         text,
    pincode         text,
    location        text,
    address         text,
    category        text,
    care_type       text,
    discipline      text,
    specialties     text,
    facilities      text,
    telephone       text,
    mobile          text,
    emergency       text,
    ambulance       text,
    website         text,
    total_beds      int,
    num_doctors     int,
    established_year int,
    latitude        double precision,
    longitude       double precision,
    total_count     bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH filtered AS (
        SELECT v.*
        FROM public.govt_hospitals_v v
        WHERE (p_search      IS NULL OR v.name       ILIKE '%' || p_search || '%')
          AND (p_state       IS NULL OR v.state       = p_state)
          AND (p_district    IS NULL OR v.district    = p_district)
          AND (p_subdistrict IS NULL OR v.subdistrict = p_subdistrict)
          AND (p_pincode     IS NULL OR v.pincode     = p_pincode)
          AND (p_care_type   IS NULL OR v.care_type   = p_care_type)
          AND (p_discipline  IS NULL OR v.discipline  = p_discipline)
          AND (p_specialty   IS NULL OR v.specialties ILIKE '%' || p_specialty || '%')
          AND (p_facility    IS NULL OR v.facilities  ILIKE '%' || p_facility  || '%')
          AND (p_min_beds    IS NULL OR v.total_beds >= p_min_beds)
    )
    SELECT
        f.sr_no, f.name, f.state, f.district, f.subdistrict, f.town, f.subtown,
        f.village, f.pincode, f.location, f.address, f.category, f.care_type,
        f.discipline, f.specialties, f.facilities, f.telephone, f.mobile,
        f.emergency, f.ambulance, f.website, f.total_beds, f.num_doctors,
        f.established_year, f.latitude, f.longitude,
        COUNT(*) OVER () AS total_count
    FROM filtered f
    ORDER BY (f.name IS NULL), f.name
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_govt_hospitals(
    text, text, text, text, text, text, text, text, text, int, int, int
) TO anon, authenticated;

-- ─────────────────────────────────────────────
-- 6. RPC — radius (map "near me") search
--    Bounding-box prefilter + haversine distance, ordered nearest first.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.govt_hospitals_near(
    p_lat       double precision,
    p_lng       double precision,
    p_radius_km double precision DEFAULT 25,
    p_limit     int              DEFAULT 100
)
RETURNS TABLE (
    sr_no           text,
    name            text,
    state           text,
    district        text,
    pincode         text,
    location        text,
    address         text,
    care_type       text,
    discipline      text,
    specialties     text,
    facilities      text,
    telephone       text,
    mobile          text,
    emergency       text,
    ambulance       text,
    website         text,
    total_beds      int,
    num_doctors     int,
    established_year int,
    latitude        double precision,
    longitude       double precision,
    distance_km     double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH bounds AS (
        SELECT
            LEAST(GREATEST(COALESCE(p_radius_km, 25), 1), 200)          AS radius,
            (LEAST(GREATEST(COALESCE(p_radius_km, 25), 1), 200) / 111.0) AS dlat
    ),
    boxed AS (
        SELECT v.*
        FROM public.govt_hospitals_v v, bounds b
        WHERE v.latitude  IS NOT NULL AND v.longitude IS NOT NULL
          AND v.latitude  BETWEEN p_lat - b.dlat AND p_lat + b.dlat
          AND v.longitude BETWEEN p_lng - (b.dlat / GREATEST(cos(radians(p_lat)), 0.01))
                              AND p_lng + (b.dlat / GREATEST(cos(radians(p_lat)), 0.01))
    ),
    measured AS (
        SELECT bx.*,
            2 * 6371 * asin(sqrt(
                power(sin(radians(bx.latitude  - p_lat) / 2), 2) +
                cos(radians(p_lat)) * cos(radians(bx.latitude)) *
                power(sin(radians(bx.longitude - p_lng) / 2), 2)
            )) AS distance_km
        FROM boxed bx
    )
    SELECT
        m.sr_no, m.name, m.state, m.district, m.pincode, m.location, m.address,
        m.care_type, m.discipline, m.specialties, m.facilities, m.telephone,
        m.mobile, m.emergency, m.ambulance, m.website, m.total_beds,
        m.num_doctors, m.established_year, m.latitude, m.longitude, m.distance_km
    FROM measured m, bounds b
    WHERE m.distance_km <= b.radius
    ORDER BY m.distance_km
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300);
$$;

GRANT EXECUTE ON FUNCTION public.govt_hospitals_near(
    double precision, double precision, double precision, int
) TO anon, authenticated;

-- ─────────────────────────────────────────────
-- 7. RPC — distinct filter options for dropdowns
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.govt_hospital_filter_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'states',      (SELECT COALESCE(jsonb_agg(s ORDER BY s), '[]'::jsonb)
                          FROM (SELECT DISTINCT state s FROM public.govt_hospitals_v WHERE state IS NOT NULL) x),
        'care_types',  (SELECT COALESCE(jsonb_agg(c ORDER BY c), '[]'::jsonb)
                          FROM (SELECT DISTINCT care_type c FROM public.govt_hospitals_v WHERE care_type IS NOT NULL) x),
        'disciplines', (SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb)
                          FROM (SELECT DISTINCT discipline d FROM public.govt_hospitals_v WHERE discipline IS NOT NULL) x)
    );
$$;

GRANT EXECUTE ON FUNCTION public.govt_hospital_filter_options() TO anon, authenticated;

-- ─────────────────────────────────────────────
-- 8. RPC — districts for a given state (cascading filter)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.govt_hospital_districts(p_state text)
RETURNS TABLE (district text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT DISTINCT v.district
    FROM public.govt_hospitals_v v
    WHERE v.district IS NOT NULL
      AND (p_state IS NULL OR v.state = p_state)
    ORDER BY v.district;
$$;

GRANT EXECUTE ON FUNCTION public.govt_hospital_districts(text) TO anon, authenticated;
