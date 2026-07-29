import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'react-toastify'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import HospitalsMap from '../components/HospitalsMap'
import {
  searchGovtHospitals,
  getGovtFilterOptions,
  getGovtDistricts,
  getGovtHospitalById,
  geocodePincode,
  reverseGeocode,
} from '../services/govtHospitals'

const PIN_RE = /^\d{6}$/
const MAX_GEOCODE_PER_PAGE = 25 // cap Nominatim calls per result page

// Haversine distance in km between two { lat, lng } points.
function distanceKm(a, b) {
  if (!a || !b) return null
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Fetch a real driving route between two points via the free OSRM demo server.
// Returns an array of [lat, lng] points, or null on failure (caller falls back
// to a straight line).
async function fetchRoute(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) return null
    const json = await res.json()
    const coords = json.routes?.[0]?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) return null
    return coords.map(([lng, lat]) => [lat, lng])
  } catch {
    return null
  }
}

// One-shot geolocation wrapped in a promise.
function getLocationOnce() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  })
}

const EMPTY_FILTERS = {
  search: '',
  state: '',
  district: '',
  pincode: '',
  careType: '',
  discipline: '',
  specialty: '',
  facility: '',
  minBeds: '',
}

export default function GovtHospitalSearch() {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [options, setOptions] = useState({ states: [], careTypes: [], disciplines: [] })
  const [districts, setDistricts] = useState([])

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)

  const [nearMode, setNearMode] = useState(false)
  const [userLocation, setUserLocation] = useState(null)
  const [locating, setLocating] = useState(false)

  const [focusKey, setFocusKey] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [routeLine, setRouteLine] = useState(null)
  const [routing, setRouting] = useState(false)
  const [pinCoords, setPinCoords] = useState({}) // pincode -> { lat, lng }
  const [fitSignal, setFitSignal] = useState(0) // bumped on each new search → map refits once

  const debounceRef = useRef(null)
  const mapCardRef = useRef(null)
  const filtersRef = useRef(filters)   // always-current filters for async callbacks
  const reqIdRef = useRef(0)           // monotonic id → ignore stale responses
  const selectedKeyRef = useRef(null)  // guards the detail-loading spinner

  // Keep the filters ref in sync so debounced/async callbacks never read stale state.
  useEffect(() => { filtersRef.current = filters }, [filters])

  function clearDebounce() {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
  }

  // ── Load dropdown options once ──
  useEffect(() => {
    getGovtFilterOptions()
      .then(setOptions)
      .catch(() => {/* dropdowns stay empty; search still works */})
    getGovtDistricts(null).then(setDistricts).catch(() => {})
  }, [])

  // ── Cascade districts when state changes ──
  useEffect(() => {
    getGovtDistricts(filters.state || null).then(setDistricts).catch(() => setDistricts([]))
  }, [filters.state])

  // ── Search runner ──
  // Uses filtersRef (never a stale closure) and a monotonic request id so that
  // an earlier-but-slower response can't overwrite a newer one. Returns the
  // result (or null when the response was superseded / errored).
  const runSearch = useCallback(async (nextPage = 0, activeFilters = filtersRef.current, { keepNearMode = false } = {}) => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    if (!keepNearMode) setNearMode(false)
    setRouteLine(null)
    try {
      const res = await searchGovtHospitals(activeFilters, nextPage)
      if (reqId !== reqIdRef.current) return null // superseded by a newer search
      setRows(res.rows)
      setTotal(res.total)
      setPage(res.page)
      setPageSize(res.pageSize)
      setFitSignal(s => s + 1)
      return res
    } catch (err) {
      if (reqId !== reqIdRef.current) return null
      console.error('Hospital search failed:', err)
      toast.error('Could not load hospitals. Please try again.')
      setRows([])
      setTotal(0)
      return null
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [])

  // Initial load.
  useEffect(() => { runSearch(0, EMPTY_FILTERS) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filter change handlers ──
  function updateFilter(key, value) {
    setFilters(prev => {
      const next = { ...prev, [key]: value }
      if (key === 'state') next.district = '' // reset dependent filter
      return next
    })
  }

  // Auto-search on dropdown/number changes (not while typing name).
  function applyDropdown(key, value) {
    clearDebounce() // a pending name search must not overwrite this change
    const next = { ...filters, [key]: value }
    if (key === 'state') next.district = ''
    setFilters(next)
    runSearch(0, next)
  }

  // Run a search from the current committed filters (used by text/number inputs
  // on blur / Enter). Reads filtersRef so it always has the latest values.
  function runFromCurrent() {
    clearDebounce()
    runSearch(0, filtersRef.current)
  }

  // Debounced name search.
  function onSearchInput(value) {
    updateFilter('search', value)
    clearDebounce()
    debounceRef.current = setTimeout(() => {
      runSearch(0, { ...filtersRef.current, search: value })
    }, 450)
  }

  function submitSearch(e) {
    e?.preventDefault()
    clearDebounce()
    runSearch(0, filtersRef.current)
  }

  function resetAll() {
    clearDebounce()
    setFilters(EMPTY_FILTERS)
    setUserLocation(null)
    setNearMode(false)
    runSearch(0, EMPTY_FILTERS)
  }

  // ── Near me ──
  // The source per-hospital coordinates are unreliable, so instead of a bogus
  // radius search we resolve the user's district from their location and scope
  // the search to it (falling back to the state). Result cards then show an
  // approximate distance computed from the reliable pincode geocode.
  async function handleNearMe() {
    clearDebounce()
    setLocating(true)
    try {
      const loc = userLocation || await getLocationOnce()
      if (!loc) {
        toast.error('Could not get your location. Please allow access and retry.')
        return
      }
      setUserLocation(loc)

      const area = await reverseGeocode(loc.lat, loc.lng)
      if (!area || (!area.district && !area.state)) {
        toast.info('Could not determine your area. Try searching by name or filters.')
        return
      }

      // Prefer district scope; fall back to state if the district name doesn't
      // match the directory's spelling (returns no rows).
      let next = { ...EMPTY_FILTERS, state: area.state || '', district: area.district || '' }
      let res = await runSearch(0, next, { keepNearMode: true })
      if (res && res.total === 0 && next.district) {
        next = { ...EMPTY_FILTERS, state: area.state || '' }
        res = await runSearch(0, next, { keepNearMode: true })
      }
      if (!res) return // superseded / failed (runSearch already handled UI)

      setFilters(next)
      setNearMode(true)
      const areaLabel = next.district || next.state
      toast.success(res.total
        ? `Showing hospitals near you${areaLabel ? ` in ${areaLabel}` : ''}.`
        : 'No hospitals found for your area.')
    } finally {
      setLocating(false)
    }
  }

  // ── Pincode geocoding: the source coordinates are unreliable, so resolve an
  // accurate location from each result's pincode (cached + throttled). ──
  useEffect(() => {
    if (!rows.length) return
    let cancelled = false
    const pins = [...new Set(rows.map(h => h.pincode).filter(p => PIN_RE.test(p || '')))]
      .slice(0, MAX_GEOCODE_PER_PAGE)
    ;(async () => {
      const resolved = {}
      await Promise.all(pins.map(async (p) => {
        const geo = await geocodePincode(p)
        if (geo) resolved[p] = geo
      }))
      if (!cancelled && Object.keys(resolved).length) {
        setPinCoords(prev => ({ ...prev, ...resolved }))
      }
    })()
    return () => { cancelled = true }
  }, [rows])

  // ── Map data ──
  // Prefer the pincode-derived location. For rows with a valid pincode we wait
  // for the geocode (rather than plotting the untrustworthy stored coordinate);
  // rows without a pincode fall back to any stored coordinate.
  const mapPlaces = useMemo(() => {
    return rows.map(h => {
      const pin = PIN_RE.test(h.pincode || '') ? h.pincode : null
      if (pin) {
        const geo = pinCoords[pin]
        if (geo) return { ...h, latitude: geo.lat, longitude: geo.lng }
        return null // awaiting geocode
      }
      if (h.latitude != null && h.longitude != null) return h
      return null
    }).filter(Boolean)
  }, [rows, pinCoords])
  const withCoords = mapPlaces.length

  // Attach an approximate distance (from the reliable pincode geocode) when the
  // user's location is known; sort nearest-first in near mode.
  const displayRows = useMemo(() => {
    const withDist = rows.map(h => {
      const geo = PIN_RE.test(h.pincode || '') ? pinCoords[h.pincode] : null
      const dist = userLocation && geo ? distanceKm(userLocation, geo) : null
      return { ...h, _dist: dist }
    })
    if (nearMode && userLocation) {
      return withDist.slice().sort((a, b) => {
        if (a._dist == null && b._dist == null) return 0
        if (a._dist == null) return 1
        if (b._dist == null) return -1
        return a._dist - b._dist
      })
    }
    return withDist
  }, [rows, pinCoords, userLocation, nearMode])

  const totalPages = nearMode ? 1 : Math.max(1, Math.ceil(total / pageSize))

  async function openDetail(place) {
    setSelected(place)
    setFocusKey(place.placeKey)
    selectedKeyRef.current = place.placeKey
    // Pull the complete record from the DB so every available column shows
    // (list/near queries return a reduced column set).
    setLoadingDetail(true)
    try {
      const full = await getGovtHospitalById(place.sr_no)
      // Ignore if the user has since opened a different hospital or closed the drawer.
      if (selectedKeyRef.current !== place.placeKey) return
      if (full) {
        setSelected(prev => (prev && prev.placeKey === full.placeKey ? { ...prev, ...full } : prev))
      }
    } catch (err) {
      console.error('Failed to load hospital detail:', err)
    } finally {
      if (selectedKeyRef.current === place.placeKey) setLoadingDetail(false)
    }
  }

  function scrollMapIntoView() {
    mapCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Draw a route to the hospital on the in-page map (not an external site).
  async function handleDirections(place) {
    setRouting(true)
    try {
      // Prefer the pincode-derived location over the unreliable stored coords.
      let dest = null
      if (PIN_RE.test(place.pincode || '')) {
        dest = pinCoords[place.pincode] || await geocodePincode(place.pincode)
      }
      if (!dest && place.latitude != null && place.longitude != null) {
        dest = { lat: place.latitude, lng: place.longitude }
      }
      if (!dest) {
        toast.error('Map location is not available for this hospital.')
        return
      }
      let loc = userLocation
      if (!loc) {
        toast.info('Getting your location for directions…')
        loc = await getLocationOnce()
        if (loc) setUserLocation(loc)
      }
      selectedKeyRef.current = null
      setSelected(null)
      setFocusKey(place.placeKey)
      scrollMapIntoView()

      if (!loc) {
        setRouteLine(null)
        toast.info('Showing the hospital on the map. Enable location access to see a route.')
        return
      }
      const route = await fetchRoute(loc, dest)
      setRouteLine(route || [[loc.lat, loc.lng], [dest.lat, dest.lng]])
    } finally {
      setRouting(false)
    }
  }

  function clearRoute() {
    setRouteLine(null)
  }

  const activeFilterCount = Object.entries(filters)
    .filter(([k, v]) => k !== 'search' && v).length

  return (
    <div>
      <Navbar />

      {/* Header */}
      <section style={{ padding: '56px 0 40px', background: 'linear-gradient(135deg, #065F46 0%, #059669 100%)' }}>
        <div className="container text-center">
          <div className="section-badge" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}>
            <i className="bi bi-hospital me-1" />Hospital Search
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'white', fontSize: 'clamp(1.8rem, 3vw, 2.6rem)', margin: '10px 0 8px' }}>
            Search Hospitals Across India
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15, maxWidth: 640, margin: '0 auto' }}>
            Search by name, filter by state, district, specialty or facility — or use the map to
            discover hospitals near you.
          </p>
        </div>
      </section>

      <main id="main-content" style={{ padding: '32px 0 80px', background: 'var(--gray-50)' }}>
        <div className="container">

          {/* Search bar */}
          <form onSubmit={submitSearch} className="mb-3">
            <div className="hero-search-bar" style={{ boxShadow: 'var(--shadow-md, 0 6px 20px rgba(0,0,0,0.08))' }}>
              <i className="bi bi-search" style={{ color: 'var(--gray-400)', fontSize: 20 }} />
              <input
                type="text"
                placeholder="Search hospitals by name…"
                value={filters.search}
                onChange={e => onSearchInput(e.target.value)}
                maxLength={80}
              />
              <button type="submit" className="btn-primary-custom" style={{ padding: '12px 24px', background: '#059669', borderColor: '#059669' }} disabled={loading}>
                {loading ? <span className="spinner-custom" style={{ width: 16, height: 16, borderWidth: 2 }} /> : 'Search'}
              </button>
            </div>
          </form>

          <div className="row g-4">
            {/* ── Filter panel ── */}
            <div className="col-lg-3">
              <div className="card-custom p-3">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0 }}>
                    <i className="bi bi-funnel me-1" />Filters
                    {activeFilterCount > 0 && <span className="badge bg-success ms-2">{activeFilterCount}</span>}
                  </h6>
                  {(activeFilterCount > 0 || filters.search) && (
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 8px', color: 'var(--primary)' }} onClick={resetAll} type="button">
                      Clear
                    </button>
                  )}
                </div>

                <FilterField label="State">
                  <select className="form-input-custom" value={filters.state} onChange={e => applyDropdown('state', e.target.value)}>
                    <option value="">All states</option>
                    {options.states.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </FilterField>

                <FilterField label="District">
                  <select className="form-input-custom" value={filters.district} onChange={e => applyDropdown('district', e.target.value)}>
                    <option value="">All districts</option>
                    {districts.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </FilterField>

                <FilterField label="Pincode">
                  <input className="form-input-custom" type="text" inputMode="numeric" maxLength={6}
                    placeholder="e.g. 110001" value={filters.pincode}
                    onChange={e => updateFilter('pincode', e.target.value.replace(/\D/g, ''))}
                    onBlur={runFromCurrent}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runFromCurrent())} />
                </FilterField>

                <FilterField label="Care Type">
                  <select className="form-input-custom" value={filters.careType} onChange={e => applyDropdown('careType', e.target.value)}>
                    <option value="">Any</option>
                    {options.careTypes.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FilterField>

                <FilterField label="System of Medicine">
                  <select className="form-input-custom" value={filters.discipline} onChange={e => applyDropdown('discipline', e.target.value)}>
                    <option value="">Any</option>
                    {options.disciplines.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </FilterField>

                <FilterField label="Specialty">
                  <input className="form-input-custom" type="text" placeholder="e.g. Cardiology"
                    value={filters.specialty}
                    onChange={e => updateFilter('specialty', e.target.value)}
                    onBlur={runFromCurrent}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runFromCurrent())} />
                </FilterField>

                <FilterField label="Facility">
                  <input className="form-input-custom" type="text" placeholder="e.g. ICU, Blood Bank"
                    value={filters.facility}
                    onChange={e => updateFilter('facility', e.target.value)}
                    onBlur={runFromCurrent}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runFromCurrent())} />
                </FilterField>

                <FilterField label="Min. Beds">
                  <input className="form-input-custom" type="number" min="0" placeholder="Any"
                    value={filters.minBeds}
                    onChange={e => updateFilter('minBeds', e.target.value)}
                    onBlur={runFromCurrent}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runFromCurrent())} />
                </FilterField>
              </div>
            </div>

            {/* ── Map + results ── */}
            <div className="col-lg-9">
              {/* Map */}
              <div className="card-custom p-2 mb-3" style={{ overflow: 'hidden' }} ref={mapCardRef}>
                <HospitalsMap
                  hospitals={mapPlaces}
                  userLocation={userLocation}
                  focusKey={focusKey}
                  routeLine={routeLine}
                  fitSignal={fitSignal}
                  onSelect={openDetail}
                  height="380px"
                />
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-2 px-1">
                  <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                    {routeLine ? (
                      <><i className="bi bi-signpost-2 me-1" style={{ color: '#059669' }} />Route shown on map</>
                    ) : (
                      <><i className="bi bi-hospital-fill me-1" style={{ color: '#059669' }} />
                        {withCoords} of {rows.length} shown have map locations</>
                    )}
                  </span>
                  <div className="d-flex align-items-center gap-2">
                    {routeLine && (
                      <button className="btn-ghost" type="button" onClick={clearRoute}
                        style={{ fontSize: 12, padding: '8px 12px', color: 'var(--primary)' }}>
                        <i className="bi bi-x-lg me-1" />Clear route
                      </button>
                    )}
                    <button className="btn-primary-custom" type="button" onClick={() => handleNearMe()} disabled={locating}
                      style={{ fontSize: 12, padding: '8px 14px', background: '#059669', borderColor: '#059669' }}>
                      {locating
                        ? <><span className="spinner-custom" style={{ width: 13, height: 13, borderWidth: 2 }} /> Locating…</>
                        : <><i className="bi bi-crosshair me-1" />Near me</>}
                    </button>
                  </div>
                </div>
              </div>

              {/* Results header */}
              <div className="d-flex justify-content-between align-items-center mb-2 px-1">
                <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0 }}>
                  {nearMode ? `Nearest Hospitals` : `Results`}
                  <span style={{ fontSize: 13, color: 'var(--gray-400)', fontWeight: 500, marginLeft: 8 }}>
                    {loading ? '' : nearMode ? `${total} found` : `${total.toLocaleString()} total`}
                  </span>
                </h6>
                {nearMode && (
                  <button className="btn-ghost" style={{ fontSize: 12, color: 'var(--primary)' }} type="button" onClick={resetAll}>
                    <i className="bi bi-arrow-left me-1" />Back to all
                  </button>
                )}
              </div>

              {/* Results list */}
              {loading ? (
                <div className="card-custom p-4 text-center">
                  <span className="spinner-custom" style={{ width: 24, height: 24, borderWidth: 3 }} />
                  <p style={{ fontSize: 13, color: 'var(--gray-400)', margin: '10px 0 0' }}>Loading hospitals…</p>
                </div>
              ) : rows.length === 0 ? (
                <div className="card-custom p-4 text-center">
                  <i className="bi bi-search" style={{ fontSize: 32, color: 'var(--gray-300)' }} />
                  <p style={{ fontSize: 14, color: 'var(--gray-500)', margin: '10px 0 0' }}>
                    No hospitals matched. Try adjusting your filters.
                  </p>
                </div>
              ) : (
                <div className="row g-3">
                  {displayRows.map(h => (
                    <div key={h.placeKey} className="col-md-6">
                      <button className="card-custom govt-result-card" onClick={() => openDetail(h)} type="button">
                        <div className="d-flex align-items-start gap-2">
                          <div className="govt-result-icon"><i className="bi bi-hospital-fill" /></div>
                          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                            <div className="govt-result-name">{h.name || 'Unnamed hospital'}</div>
                            <div className="govt-result-meta">
                              <i className="bi bi-geo-alt me-1" />
                              {[h.district, h.state].filter(Boolean).join(', ') || h.pincode || 'Location unavailable'}
                            </div>
                            <div className="d-flex flex-wrap gap-1 mt-2">
                              {h.care_type && <span className="govt-chip">{h.care_type}</span>}
                              {h.discipline && <span className="govt-chip subtle">{h.discipline}</span>}
                              {h.total_beds != null && <span className="govt-chip subtle"><i className="bi bi-hospital me-1" />{h.total_beds} beds</span>}
                            </div>
                          </div>
                          {h._dist != null && (
                            <span className="hospital-nearby-distance" title="Approximate distance (pincode-based)">≈ {h._dist.toFixed(1)} km</span>
                          )}
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination (search mode only) */}
              {!nearMode && !loading && total > pageSize && (
                <div className="d-flex justify-content-center align-items-center gap-3 mt-4">
                  <button className="btn-ghost" type="button" disabled={page <= 0}
                    onClick={() => runSearch(page - 1, filters)} style={{ fontSize: 13 }}>
                    <i className="bi bi-chevron-left me-1" />Prev
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>Page {page + 1} of {totalPages}</span>
                  <button className="btn-ghost" type="button" disabled={page + 1 >= totalPages}
                    onClick={() => runSearch(page + 1, filters)} style={{ fontSize: 13 }}>
                    Next<i className="bi bi-chevron-right ms-1" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {selected && (
        <GovtHospitalDrawer
          place={selected}
          loading={loadingDetail}
          routing={routing}
          onClose={() => { selectedKeyRef.current = null; setSelected(null) }}
          onDirections={handleDirections}
        />
      )}
    </div>
  )
}

function FilterField({ label, children }) {
  return (
    <div className="mb-3">
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

function GovtHospitalDrawer({ place, loading, routing, onClose, onDirections }) {
  const hasCoords = (place.latitude != null && place.longitude != null) ||
    /^\d{6}$/.test(place.pincode || '')

  const contacts = [
    { label: 'Telephone', value: place.telephone, icon: 'bi-telephone', href: place.telephone ? `tel:${place.telephone}` : null },
    { label: 'Mobile', value: place.mobile, icon: 'bi-phone', href: place.mobile ? `tel:${place.mobile}` : null },
    { label: 'Emergency', value: place.emergency, icon: 'bi-exclamation-octagon', href: place.emergency ? `tel:${place.emergency}` : null },
    { label: 'Ambulance', value: place.ambulance, icon: 'bi-truck-front', href: place.ambulance ? `tel:${place.ambulance}` : null },
  ].filter(c => c.value)

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="hosp-drawer">
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0, fontSize: 18 }} className="truncate">
              {place.name || 'Unnamed hospital'}
            </h5>
            <span style={{ fontSize: 12, color: '#059669', fontWeight: 700 }}>
              <i className="bi bi-hospital me-1" />Hospital
              {loading && <span className="spinner-custom ms-2" style={{ width: 11, height: 11, borderWidth: 2, display: 'inline-block', verticalAlign: 'middle' }} />}
            </span>
          </div>
          <button className="btn-ghost" onClick={onClose} style={{ padding: 8 }}>
            <i className="bi bi-x-lg" style={{ fontSize: 18 }} />
          </button>
        </div>

        <div className="modal-body">
          <div className="d-flex flex-wrap gap-1 mb-3">
            {place.care_type && <span className="govt-chip">{place.care_type}</span>}
            {place.discipline && <span className="govt-chip subtle">{place.discipline}</span>}
            {place.category && <span className="govt-chip subtle">{place.category}</span>}
          </div>

          <div className="detail-section">
            <div className="detail-row">
              <span className="detail-label">Address</span>
              <span className="detail-value">
                {[place.address, place.location, place.village, place.town, place.subdistrict, place.district, place.state, place.pincode]
                  .filter(Boolean).join(', ') || '—'}
              </span>
            </div>
            {place.pincode && (
              <div className="detail-row"><span className="detail-label">Pincode</span><span className="detail-value">{place.pincode}</span></div>
            )}
          </div>

          {/* Stats */}
          <div className="detail-section">
            <div className="row g-2 text-center">
              <StatBox label="Beds" value={place.total_beds} icon="bi-hospital" />
              <StatBox label="Doctors" value={place.num_doctors} icon="bi-person-badge" />
              <StatBox label="Since" value={place.established_year} icon="bi-calendar3" />
            </div>
          </div>

          {/* Contacts */}
          {contacts.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-title"><i className="bi bi-telephone me-1" />Contact</div>
              {contacts.map(c => (
                <div className="detail-row" key={c.label}>
                  <span className="detail-label"><i className={`bi ${c.icon} me-1`} />{c.label}</span>
                  {c.href ? <a className="detail-value" href={c.href}>{c.value}</a> : <span className="detail-value">{c.value}</span>}
                </div>
              ))}
              {place.website && (
                <div className="detail-row">
                  <span className="detail-label"><i className="bi bi-globe me-1" />Website</span>
                  <a className="detail-value" href={place.website.startsWith('http') ? place.website : `https://${place.website}`} target="_blank" rel="noopener noreferrer">Visit ↗</a>
                </div>
              )}
            </div>
          )}

          {/* Specialties */}
          {place.specialtyList.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-title"><i className="bi bi-clipboard2-pulse me-1" />Specialties</div>
              <div className="d-flex flex-wrap gap-1">
                {place.specialtyList.map((s, i) => <span key={i} className="govt-chip subtle">{s}</span>)}
              </div>
            </div>
          )}

          {/* Facilities */}
          {place.facilityList.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-title"><i className="bi bi-building-check me-1" />Facilities</div>
              <div className="d-flex flex-wrap gap-1">
                {place.facilityList.map((f, i) => <span key={i} className="govt-chip subtle">{f}</span>)}
              </div>
            </div>
          )}

          <button type="button" className="btn-primary-custom w-100 justify-content-center mt-2"
            onClick={() => onDirections(place)} disabled={routing || !hasCoords}
            style={{ background: '#059669', borderColor: '#059669', opacity: hasCoords ? 1 : 0.6 }}>
            {routing
              ? <><span className="spinner-custom" style={{ width: 16, height: 16, borderWidth: 2 }} /> Building route…</>
              : <><i className="bi bi-signpost-2 me-1" />{hasCoords ? 'Get Directions' : 'Location unavailable'}</>}
          </button>
        </div>
      </div>
    </>
  )
}

function StatBox({ label, value, icon }) {
  return (
    <div className="col-4">
      <div style={{ background: 'var(--gray-50)', borderRadius: 10, padding: '10px 6px' }}>
        <i className={`bi ${icon}`} style={{ color: '#059669', fontSize: 16 }} />
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--dark)' }}>{value != null ? value : '—'}</div>
        <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{label}</div>
      </div>
    </div>
  )
}
