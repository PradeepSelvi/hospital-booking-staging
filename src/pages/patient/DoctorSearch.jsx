import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { getDoctors } from '../../services/doctors'
import { getAllHospitals, getPhotoUrl } from '../../services/hospital'
import { getDepartments } from '../../services/admin'
import DoctorCard from '../../components/DoctorCard'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import useDebounce from '../../hooks/useDebounce'
import { SkeletonDoctorCard } from '../../components/SkeletonLoader'

const SPECIALIZATIONS = [
  'Cardiology', 'Neurology', 'Orthopedics', 'Pediatrics',
  'Dermatology', 'Gynecology', 'Ophthalmology', 'ENT',
  'General Physician', 'Psychiatry', 'Urology', 'Oncology'
]

export default function DoctorSearch() {
  const { t } = useTranslation('patient')
  const [searchParams, setSearchParams] = useSearchParams()

  const HOSPITAL_TYPE_LABELS = {
    GOVERNMENT: t('doctorSearch.typeGovernment'),
    PRIVATE: t('doctorSearch.typePrivate'),
    CLINIC: t('doctorSearch.typeClinic'),
    MULTI_SPECIALTY: t('doctorSearch.typeMultiSpecialty'),
  }

  const [doctors, setDoctors] = useState([])
  const [hospitals, setHospitals] = useState([])
  const [loading, setLoading] = useState(true)
  const [departments, setDepartments] = useState([])

  // Initialise from URL query params (set by the landing-page search bar)
  const [filters, setFilters] = useState({
    search: searchParams.get('search') ?? '',
    specialization: searchParams.get('spec') ?? '',
    department_id: '',
  })

  // Debounce the free-text term to avoid querying on every keystroke
  const debouncedSearch = useDebounce(filters.search, 300)

  useEffect(() => {
    getDepartments().then(setDepartments).catch(console.error)
  }, [])

  // Keep the URL in sync so results are shareable/bookmarkable
  useEffect(() => {
    const next = {}
    if (debouncedSearch.trim()) next.search = debouncedSearch.trim()
    if (filters.specialization) next.spec = filters.specialization
    setSearchParams(next, { replace: true })
  }, [debouncedSearch, filters.specialization, setSearchParams])

  // Reload results whenever the search term or filters change
  useEffect(() => {
    loadData({ ...filters, search: debouncedSearch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, filters.specialization, filters.department_id])

  async function loadData(f) {
    try {
      setLoading(true)
      const term = f.search?.trim()

      const [docData, hospData] = await Promise.all([
        getDoctors({
          search: term || undefined,
          specialization: f.specialization || undefined,
          department_id: f.department_id || undefined,
        }),
        // Only search hospitals when the user typed a free-text term
        term ? getAllHospitals({ search: term }) : Promise.resolve([]),
      ])

      setDoctors(docData ?? [])
      setHospitals(hospData ?? [])
    } catch (err) {
      console.error(err)
      setDoctors([])
      setHospitals([])
    } finally {
      setLoading(false)
    }
  }

  function handleFilterChange(key, val) {
    setFilters(prev => ({ ...prev, [key]: val }))
  }

  function clearFilters() {
    setFilters({ search: '', specialization: '', department_id: '' })
  }

  const hasQuery = filters.search.trim() || filters.specialization || filters.department_id

  return (
    <div>
      <Navbar />

      {/* Page Header */}
      <div className="page-header">
        <div className="container">
          <div className="section-badge">{t('doctorSearch.badge')}</div>
          <h1 style={{ fontSize: 'clamp(1.8rem, 3vw, 2.6rem)', color: 'white', fontFamily: 'var(--font-display)', position: 'relative', zIndex: 1 }}>
            {t('doctorSearch.title')}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: 10, fontSize: 16, position: 'relative', zIndex: 1 }}>
            {t('doctorSearch.searchAcrossDoctors', { count: doctors.length })}
            {hospitals.length > 0 ? t('doctorSearch.andHospitals', { count: hospitals.length }) : ''}
          </p>

          {/* Main search bar */}
          <div className="hero-search-bar" style={{ marginTop: 24, position: 'relative', zIndex: 1, maxWidth: 640 }}>
            <i className="bi bi-search" style={{ color: 'var(--gray-400)', fontSize: 20 }} />
            <input
              id="main-search"
              type="text"
              placeholder={t('doctorSearch.searchPlaceholder')}
              value={filters.search}
              onChange={e => handleFilterChange('search', e.target.value)}
              maxLength={60}
              aria-label={t('doctorSearch.searchAriaLabel')}
            />
            {filters.search && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => handleFilterChange('search', '')}
                style={{ padding: '8px 14px' }}
                aria-label={t('doctorSearch.clearSearchAria')}
              >
                <i className="bi bi-x-lg" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="container py-5">
        <div className="row g-4">
          {/* Filters Sidebar */}
          <div className="col-lg-3">
            <div className="card-custom p-4 position-sticky" style={{ top: 90 }}>
              <div className="d-flex justify-content-between align-items-center mb-4">
                <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0 }}>
                  <i className="bi bi-funnel me-2 text-primary" />{t('doctorSearch.filters')}
                </h6>
                <button className="btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }} onClick={clearFilters}>
                  {t('doctorSearch.clearAll')}
                </button>
              </div>

              {/* Specialization */}
              <div className="mb-4">
                <label className="form-label-custom">{t('doctorSearch.specialization')}</label>
                <div className="d-flex flex-column gap-2">
                  {SPECIALIZATIONS.map(spec => (
                    <label
                      key={spec}
                      className="d-flex align-items-center gap-2 cursor-pointer"
                      style={{ fontSize: 14, color: 'var(--gray-600)', padding: '4px 0' }}
                    >
                      <input
                        type="radio"
                        name="specialization"
                        value={spec}
                        checked={filters.specialization === spec}
                        onChange={e => handleFilterChange('specialization', e.target.value)}
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      {spec}
                    </label>
                  ))}
                </div>
              </div>

              {departments.length > 0 && (
                <div className="mb-4">
                  <label className="form-label-custom">{t('doctorSearch.department')}</label>
                  <select
                    id="doctor-filter-dept"
                    className="form-input-custom"
                    value={filters.department_id}
                    onChange={e => handleFilterChange('department_id', e.target.value)}
                  >
                    <option value="">{t('doctorSearch.allDepartments')}</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="col-lg-9">
            {loading ? (
              <SkeletonDoctorCard count={6} />
            ) : (
              <>
                {/* Hospitals section (only when a free-text term is present) */}
                {hospitals.length > 0 && (
                  <div className="mb-5">
                    <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16, color: 'var(--dark)' }}>
                      <i className="bi bi-hospital me-2 text-primary" />
                      {t('doctorSearch.hospitals')} <span style={{ color: 'var(--gray-400)', fontWeight: 500, fontSize: 14 }}>({hospitals.length})</span>
                    </h5>
                    <div className="row g-3 stagger-children">
                      {hospitals.map(h => (
                        <div key={h.id} className="col-md-6">
                          <div className="card-custom p-3 h-100 d-flex gap-3 align-items-start">
                            <div style={{
                              width: 56, height: 56, borderRadius: 'var(--radius-md)', flexShrink: 0,
                              background: 'rgba(0,119,182,0.08)', display: 'flex', alignItems: 'center',
                              justifyContent: 'center', overflow: 'hidden'
                            }}>
                              {h.cover_photo_url
                                ? <img src={getPhotoUrl(h.cover_photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <i className="bi bi-hospital" style={{ fontSize: 24, color: 'var(--primary)' }} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="d-flex align-items-center gap-2">
                                <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, margin: 0, color: 'var(--dark)' }} className="truncate">
                                  {h.name}
                                </h6>
                                {h.is_verified && <i className="bi bi-patch-check-fill" style={{ color: '#2DC653', fontSize: 13 }} title={t('doctorSearch.verified')} />}
                              </div>
                              {h.type && (
                                <p style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, margin: '2px 0 0' }}>
                                  {HOSPITAL_TYPE_LABELS[h.type] ?? h.type}
                                </p>
                              )}
                              {(h.city || h.state) && (
                                <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: '6px 0 0' }}>
                                  <i className="bi bi-geo-alt me-1" />
                                  {[h.city, h.state].filter(Boolean).join(', ')}
                                </p>
                              )}
                              {h.website && (
                                <a
                                  href={h.website.startsWith('http') ? h.website : `https://${h.website}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ fontSize: 12, color: 'var(--primary)' }}
                                >
                                  <i className="bi bi-globe me-1" />{t('doctorSearch.visitWebsite')}
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Doctors section */}
                <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16, color: 'var(--dark)' }}>
                  <i className="bi bi-person-badge me-2 text-primary" />
                  {t('doctorSearch.doctors')} <span style={{ color: 'var(--gray-400)', fontWeight: 500, fontSize: 14 }}>({doctors.length})</span>
                </h5>

                {doctors.length === 0 ? (
                  <div className="empty-state">
                    <i className="bi bi-person-x" />
                    <p>
                      {hasQuery
                        ? t('doctorSearch.noDoctorsFound')
                        : t('doctorSearch.startTyping')}
                    </p>
                    {hasQuery && (
                      <button className="btn-outline-custom mt-3" onClick={clearFilters}>{t('doctorSearch.clearSearch')}</button>
                    )}
                  </div>
                ) : (
                  <div className="row g-3 stagger-children">
                    {doctors.map(doc => (
                      <div key={doc.id} className="col-md-6 col-xl-4">
                        <DoctorCard doctor={doc} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
