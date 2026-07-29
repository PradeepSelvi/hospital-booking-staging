import { useState, useEffect, useMemo } from 'react'
import { getAllHospitals, getPhotoUrl } from '../services/hospital'

const TYPE_LABELS = {
  GOVERNMENT: 'Government',
  PRIVATE: 'Private',
  CLINIC: 'Clinic',
  MULTI_SPECIALTY: 'Multi-Specialty',
}

/**
 * DoctorHospitalSelector — searchable list of active hospitals a doctor
 * can join. Excludes hospitals the doctor is already affiliated with.
 *
 * Props:
 * - excludeIds: number[] — hospital IDs to hide (already affiliated)
 * - onSelect: (hospital) => void
 * - joining: number|null — hospital ID currently being joined
 */
export default function DoctorHospitalSelector({ excludeIds = [], onSelect, joining = null }) {
  const [hospitals, setHospitals] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    getAllHospitals()
      .then(data => { if (active) setHospitals(data) })
      .catch(() => { if (active) setHospitals([]) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const filtered = useMemo(() => {
    const excluded = new Set(excludeIds)
    const term = search.trim().toLowerCase()
    return hospitals
      .filter(h => !excluded.has(h.id))
      .filter(h => !term ||
        h.name?.toLowerCase().includes(term) ||
        h.city?.toLowerCase().includes(term))
  }, [hospitals, excludeIds, search])

  return (
    <div className="hospital-selector">
      <div className="search-input-wrapper" style={{ marginBottom: 12 }}>
        <i className="bi bi-search" />
        <input
          type="text"
          className="form-input-custom"
          placeholder="Search hospitals by name or city..."
          style={{ paddingLeft: 42 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={100}
        />
      </div>

      {loading ? (
        <div className="d-flex align-items-center gap-2" style={{ padding: 24, color: 'var(--gray-400)', fontSize: 13 }}>
          <div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} />
          Loading hospitals...
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: 32 }}>
          <i className="bi bi-hospital" />
          <p>{search ? 'No matching hospitals' : 'No hospitals available to join'}</p>
        </div>
      ) : (
        <div className="hospital-selector-list">
          {filtered.map(h => {
            const cover = getPhotoUrl(h.cover_photo_url)
            const isJoining = joining === h.id
            return (
              <div key={h.id} className="hospital-selector-item">
                <div className="hospital-selector-avatar">
                  {cover ? (
                    <img src={cover} alt={h.name} />
                  ) : (
                    <i className="bi bi-hospital" />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="hospital-selector-name">{h.name}</div>
                  <div className="hospital-selector-meta">
                    {h.type && <span>{TYPE_LABELS[h.type] || h.type}</span>}
                    {h.city && <span><i className="bi bi-geo-alt" />{h.city}{h.state ? `, ${h.state}` : ''}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary-custom"
                  style={{ fontSize: 12, padding: '6px 14px' }}
                  disabled={isJoining}
                  onClick={() => onSelect?.(h)}
                >
                  {isJoining ? (
                    <><div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} /> Joining...</>
                  ) : (
                    <><i className="bi bi-plus-lg me-1" />Join</>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
