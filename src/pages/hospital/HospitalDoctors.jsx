import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import { toast } from 'react-toastify'
import {
  getHospitalByOwnerId, getHospitalDoctors, removeAffiliation,
} from '../../services/hospital'
import { SkeletonTable } from '../../components/SkeletonLoader'
import './HospitalDoctors.css'

const STATUS_BADGE = {
  APPROVED: { label: 'Active', cls: 'badge-confirmed', icon: 'bi-check-circle' },
  PENDING: { label: 'Pending', cls: 'badge-pending', icon: 'bi-clock' },
  REJECTED: { label: 'Removed', cls: 'badge-cancelled', icon: 'bi-x-circle' },
}

export default function HospitalDoctors() {
  const { user } = useAuth()
  const [hospital, setHospital] = useState(null)
  const [affiliations, setAffiliations] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [removing, setRemoving] = useState(null)

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData() {
    try {
      setLoading(true)
      const h = await getHospitalByOwnerId(user.id)
      setHospital(h)
      if (h) {
        const docs = await getHospitalDoctors(h.id)
        setAffiliations(docs)
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load doctors')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return affiliations
    return affiliations.filter(aff => {
      const name = aff.doctors?.profiles?.name?.toLowerCase() ?? ''
      const spec = aff.doctors?.specialization?.toLowerCase() ?? ''
      return name.includes(term) || spec.includes(term)
    })
  }, [affiliations, search])

  async function handleRemove(aff) {
    if (!confirm(`Remove Dr. ${aff.doctors?.profiles?.name ?? 'this doctor'} from your hospital?`)) return
    try {
      setRemoving(aff.id)
      await removeAffiliation(aff.id, aff.doctor_id, hospital.id)
      setAffiliations(prev => prev.filter(a => a.id !== aff.id))
      toast.success('Doctor removed from hospital')
    } catch (err) {
      toast.error(err.message || 'Failed to remove doctor')
    } finally {
      setRemoving(null)
    }
  }

  if (loading) return (
    <div>
      <div className="skeleton skeleton-heading" style={{ marginBottom: 'var(--space-4)' }} />
      <SkeletonTable rows={6} cols={5} />
    </div>
  )

  return (
    <div className="hospital-doctors">
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <div>
          <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
            <i className="bi bi-people me-2 text-primary" />Affiliated Doctors
          </h4>
          <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
            Doctors who have joined {hospital?.name ?? 'your hospital'}
          </p>
        </div>
        <div style={{
          padding: '8px 16px', borderRadius: 'var(--radius-full)', fontSize: 13,
          fontWeight: 700, background: 'rgba(0,119,182,0.1)', color: 'var(--primary)'
        }}>
          <i className="bi bi-people me-1" />{affiliations.length} Doctors
        </div>
      </div>

      <div className="card-custom p-3 mb-4">
        <div className="search-input-wrapper" style={{ maxWidth: 360 }}>
          <i className="bi bi-search" />
          <input
            type="text"
            className="form-input-custom"
            placeholder="Search by name or specialization..."
            style={{ paddingLeft: 42 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
            maxLength={100}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card-custom">
          <div className="empty-state" style={{ padding: 48 }}>
            <i className="bi bi-person-x" style={{ fontSize: 48, color: 'var(--gray-300)' }} />
            <p style={{ fontWeight: 600, color: 'var(--gray-500)', marginTop: 16 }}>
              {search ? 'No matching doctors' : 'No doctors have joined yet'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>
              Doctors can find and join your hospital from their profile page.
            </p>
          </div>
        </div>
      ) : (
        <div className="hospital-doctors-grid">
          {filtered.map(aff => {
            const doc = aff.doctors
            const prof = doc?.profiles
            const name = prof?.name || 'Doctor'
            const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
            const photo = doc?.photo_url || prof?.avatar_url
            const badge = STATUS_BADGE[aff.status] ?? STATUS_BADGE.APPROVED
            return (
              <div key={aff.id} className="hospital-doctor-card">
                <div className="hospital-doctor-head">
                  <div className="hospital-doctor-avatar">
                    {photo
                      ? <img src={photo} alt={name} />
                      : <span className="hospital-doctor-initials">{initials}</span>}
                  </div>
                  <div className="hospital-doctor-headtext">
                    <div className="hospital-doctor-name">
                      Dr. {name}
                      {aff.is_primary && (
                        <i className="bi bi-star-fill hospital-doctor-primary" title="Primary hospital" />
                      )}
                    </div>
                    <div className="hospital-doctor-spec">{doc?.specialization ?? 'General'}</div>
                  </div>
                </div>

                <div className="hospital-doctor-meta">
                  {doc?.qualification && <span><i className="bi bi-mortarboard" />{doc.qualification}</span>}
                  <span><i className="bi bi-briefcase" />{doc?.experience_years ?? 0} yrs experience</span>
                  {doc?.departments?.name && <span><i className="bi bi-diagram-3" />{doc.departments.name}</span>}
                  {doc?.consultation_fee != null && <span><i className="bi bi-cash-coin" />₹{doc.consultation_fee} consultation</span>}
                  {prof?.email && <span className="truncate"><i className="bi bi-envelope" />{prof.email}</span>}
                  {prof?.phone && <span><i className="bi bi-telephone" />{prof.phone}</span>}
                </div>

                <div className="hospital-doctor-foot">
                  <span className={badge.cls} style={{ fontSize: 11, padding: '2px 10px' }}>
                    <i className={`bi ${badge.icon} me-1`} />{badge.label}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, color: 'var(--danger)' }}
                    disabled={removing === aff.id}
                    onClick={() => handleRemove(aff)}
                  >
                    {removing === aff.id ? (
                      <div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    ) : (
                      <><i className="bi bi-person-dash me-1" />Remove</>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
