// govtHospitals.js
// Search over the national government-hospital directory (`hospital_dicnory`).
//
// All access goes through the RPCs defined in migration 036:
//   • search_govt_hospitals()        → paginated name/filter search
//   • govt_hospitals_near()          → radius ("near me") search for the map
//   • govt_hospital_filter_options() → distinct states / care types / disciplines
//   • govt_hospital_districts()      → districts for a chosen state (cascade)
//
// The RPCs already convert the raw table's "0"/blank sentinels to NULL and
// parse "lat, lng" into numeric latitude/longitude. This layer adds:
//   • parsing of the free-text Specialties / Facilities lists into arrays
//   • a stable `placeKey` (so the shared HospitalsMap can key markers)
//   • search-term sanitization (PostgREST-injection safe)

import { supabase } from '../lib/supabase'
import { sanitizeSearchTerm } from '../security/sanitize'

const PAGE_SIZE = 20

// ─────────────────────────────────────────────
// Pincode geocoding
// The source table's `Location_Coordinates` are mostly empty or unreliable
// (many rows share bogus coordinates), so we derive an accurate map location
// from the hospital's 6-digit pincode via OSM Nominatim. Results are cached in
// localStorage (incl. negative results) and network calls are throttled to
// respect Nominatim's usage policy (max ~1 req/sec).
// ─────────────────────────────────────────────
const PIN_CACHE_KEY = 'govt_pincode_geo_v1'
let _pinCache = null

function loadPinCache() {
  if (_pinCache) return _pinCache
  try { _pinCache = JSON.parse(localStorage.getItem(PIN_CACHE_KEY) || '{}') } catch { _pinCache = {} }
  return _pinCache
}
function savePinCache() {
  try { localStorage.setItem(PIN_CACHE_KEY, JSON.stringify(_pinCache)) } catch { /* ignore quota */ }
}

let _geoQueue = Promise.resolve()
let _lastGeoCall = 0
function throttleGeo() {
  _geoQueue = _geoQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - _lastGeoCall))
    if (wait) await new Promise(r => setTimeout(r, wait))
    _lastGeoCall = Date.now()
  })
  return _geoQueue
}

/**
 * Reverse-geocode a coordinate to the user's administrative area
 * ({ state, district, pincode }) via OSM Nominatim. Throttled; returns null on
 * failure. Used by "Near me" to scope the search to the user's district.
 */
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null
  await throttleGeo()
  try {
    const params = new URLSearchParams({
      lat: String(lat), lon: String(lng), format: 'json', addressdetails: '1', zoom: '10',
    })
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const a = json.address || {}
    return {
      state: a.state || null,
      district: a.state_district || a.county || a.district || null,
      pincode: a.postcode || null,
    }
  } catch {
    return null
  }
}

/**
 * Resolve a 6-digit Indian pincode to { lat, lng } (or null). Cached + throttled.
 */
export async function geocodePincode(pincode) {
  const pin = String(pincode ?? '').trim()
  if (!/^\d{6}$/.test(pin)) return null
  const cache = loadPinCache()
  if (pin in cache) return cache[pin] // may be a cached null (negative)
  await throttleGeo()
  // Re-check cache in case a concurrent request resolved it while queued.
  if (pin in cache) return cache[pin]
  try {
    const params = new URLSearchParams({
      postalcode: pin, country: 'India', format: 'json', limit: '1',
    })
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const rows = await res.json()
    const hit = rows?.[0]
    const val = hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null
    cache[pin] = val
    savePinCache()
    return val
  } catch {
    return null
  }
}

/**
 * Split a free-text comma / newline / semicolon separated list into a clean
 * array of trimmed, de-duplicated, non-empty items.
 */
export function parseList(raw) {
  if (!raw || typeof raw !== 'string') return []
  const parts = raw
    .split(/[,\n;|]+/)
    .map(s => s.trim())
    .filter(s => s && s !== '0')
  return Array.from(new Set(parts))
}

/**
 * Normalize a raw RPC row into the shape the UI + shared map expect.
 */
export function normalizeGovtRow(row) {
  if (!row) return null
  const lat = row.latitude != null ? Number(row.latitude) : null
  const lng = row.longitude != null ? Number(row.longitude) : null
  return {
    ...row,
    placeKey: `govt:${row.sr_no}`,
    external: false,
    govt: true,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    specialtyList: parseList(row.specialties),
    facilityList: parseList(row.facilities),
    // Shared map/list components read `city` + rating fields.
    city: row.district || row.town || row.subdistrict || null,
    avg_rating: 0,
    review_count: 0,
  }
}

/**
 * Paginated search over the directory.
 * @param {Object} filters
 * @param {number} page - 0-based page index
 * @returns {Promise<{ rows: Array, total: number, page: number, pageSize: number }>}
 */
export async function searchGovtHospitals(filters = {}, page = 0) {
  const pageSize = filters.pageSize || PAGE_SIZE
  const clean = (v) => {
    if (v == null) return null
    const s = sanitizeSearchTerm(String(v))
    return s.length ? s : null
  }
  // Exact-match filters (state/district/pincode/care type/discipline) come from
  // controlled dropdowns, so only trim them — do not strip characters that may
  // legitimately appear in the stored value.
  const exact = (v) => {
    if (v == null) return null
    const s = String(v).trim()
    return s.length ? s : null
  }

  const { data, error } = await supabase.rpc('search_govt_hospitals', {
    p_search: clean(filters.search),
    p_state: exact(filters.state),
    p_district: exact(filters.district),
    p_subdistrict: exact(filters.subdistrict),
    p_pincode: exact(filters.pincode),
    p_care_type: exact(filters.careType),
    p_discipline: exact(filters.discipline),
    p_specialty: clean(filters.specialty),
    p_facility: clean(filters.facility),
    p_min_beds: filters.minBeds != null && filters.minBeds !== '' ? Number(filters.minBeds) : null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  })
  if (error) throw error

  const rows = (data ?? []).map(normalizeGovtRow)
  const total = data?.[0]?.total_count ? Number(data[0].total_count) : 0
  return { rows, total, page, pageSize }
}

/**
 * Fetch the complete record for a single hospital by its Sr_No.
 * Used when opening the detail drawer so every available column is shown
 * (the list/near queries return a reduced column set).
 */
export async function getGovtHospitalById(srNo) {
  if (srNo == null) return null
  const { data, error } = await supabase
    .from('govt_hospitals_v')
    .select('*')
    .eq('sr_no', String(srNo))
    .maybeSingle()
  if (error) throw error
  return data ? normalizeGovtRow(data) : null
}

/**
 * Radius search for the map "near me" flow.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusKm
 * @param {number} limit
 * @returns {Promise<Array>} normalized rows including numeric `distance` (km)
 */
export async function getGovtHospitalsNear(lat, lng, radiusKm = 25, limit = 150) {
  const { data, error } = await supabase.rpc('govt_hospitals_near', {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radiusKm,
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []).map(row => {
    const norm = normalizeGovtRow(row)
    norm.distance = row.distance_km != null ? Number(row.distance_km) : null
    return norm
  })
}

/**
 * Distinct filter options for the dropdowns (states, care types, disciplines).
 */
export async function getGovtFilterOptions() {
  const { data, error } = await supabase.rpc('govt_hospital_filter_options')
  if (error) throw error
  return {
    states: data?.states ?? [],
    careTypes: data?.care_types ?? [],
    disciplines: data?.disciplines ?? [],
  }
}

/**
 * Districts belonging to a state (cascading filter). Returns all districts
 * when no state is provided.
 */
export async function getGovtDistricts(state) {
  const { data, error } = await supabase.rpc('govt_hospital_districts', {
    p_state: state ? String(state).trim() : null,
  })
  if (error) throw error
  return (data ?? []).map(r => r.district).filter(Boolean)
}
