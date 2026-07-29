import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { toast } from 'react-toastify'
import {
  getHospitalByOwnerId, getHospitalStats, getHospitalDoctors,
  computeProfileCompletion
} from '../../services/hospital'
import { SkeletonKPI } from '../../components/SkeletonLoader'

export default function HospitalDashboard() {
  const { user, profile } = useAuth()
  const [hospital, setHospital] = useState(null)
  const [stats, setStats] = useState({ totalDoctors: 0, totalPhotos: 0 })
  const [recentDoctors, setRecentDoctors] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData() {
    try {
      setLoading(true)
      const h = await getHospitalByOwnerId(user.id)
      setHospital(h)
      if (h) {
        const [s, docs] = await Promise.all([
          getHospitalStats(h.id),
          getHospitalDoctors(h.id),
        ])
        setStats(s)
        setRecentDoctors(docs.slice(0, 5))
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div>
      <div className="skeleton skeleton-heading" style={{ marginBottom: 'var(--space-6)' }} />
      <SkeletonKPI count={3} />
    </div>
  )

  if (!hospital) return (
    <div className="card-custom p-4">
      <div className="empty-state" style={{ padding: 48 }}>
        <i className="bi bi-hospital" style={{ fontSize: 48, color: 'var(--gray-300)' }} />
        <p style={{ fontWeight: 600, color: 'var(--gray-500)', marginTop: 16 }}>
          No hospital profile found
        </p>
        <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>
          Your hospital account is not linked to a hospital record yet. Please contact the administrator.
        </p>
      </div>
    </div>
  )

  const completion = computeProfileCompletion(hospital)

  return (
    <div>
      <div className="mb-4">
        <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
          <i className="bi bi-hospital me-2 text-primary" />{hospital.name}
        </h4>
        <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
          Welcome back, {profile?.name ?? 'Hospital Admin'}. Here's your hospital overview.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="row g-3 mb-4 stagger-children">
        {[
          { icon: 'bi-people-fill', value: stats.totalDoctors, label: 'Affiliated Doctors', color: 'var(--primary)', bg: 'rgba(0,119,182,0.1)' },
          { icon: 'bi-images', value: stats.totalPhotos, label: 'Gallery Photos', color: 'var(--info)', bg: 'rgba(76,201,240,0.1)' },
          { icon: 'bi-patch-check', value: `${completion}%`, label: 'Profile Completion', color: 'var(--success)', bg: 'rgba(45,198,83,0.1)' },
        ].map((stat, i) => (
          <div key={i} className="col-6 col-xl-4">
            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: stat.bg, color: stat.color }}>
                <i className={`bi ${stat.icon}`} />
              </div>
              <div className="kpi-value">{stat.value}</div>
              <div className="kpi-label">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="card-custom p-4 mb-4">
        <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
          <i className="bi bi-lightning-charge me-2 text-primary" />Quick Actions
        </h6>
        <div className="d-flex gap-3 flex-wrap">
          <Link to="/hospital/profile" className="btn-primary-custom" style={{ textDecoration: 'none' }}>
            <i className="bi bi-pencil-square me-1" />Edit Profile
          </Link>
          <Link to="/hospital/profile" className="btn-outline-custom" style={{ textDecoration: 'none' }}>
            <i className="bi bi-images me-1" />Manage Photos
          </Link>
          <Link to="/hospital/doctors" className="btn-outline-custom" style={{ textDecoration: 'none' }}>
            <i className="bi bi-people me-1" />Manage Doctors
          </Link>
        </div>
        {completion < 100 && (
          <div style={{
            marginTop: 16, padding: '12px 14px', borderRadius: 'var(--radius-md, 10px)',
            background: 'rgba(249,199,79,0.1)', fontSize: 13, color: '#D97706'
          }}>
            <i className="bi bi-info-circle me-1" />
            Your profile is {completion}% complete. Add more details to help patients and doctors find you.
          </div>
        )}
      </div>

      {/* Recent Doctors */}
      <div className="card-custom p-4">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0 }}>
            <i className="bi bi-people me-2 text-primary" />Recently Joined Doctors
          </h6>
          <Link to="/hospital/doctors" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}>
            View all
          </Link>
        </div>
        {recentDoctors.length === 0 ? (
          <div className="empty-state" style={{ padding: 32 }}>
            <i className="bi bi-person-x" />
            <p>No doctors have joined yet</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table-custom">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Specialization</th>
                  <th>Experience</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {recentDoctors.map(aff => (
                  <tr key={aff.id}>
                    <td style={{ fontWeight: 500 }}>Dr. {aff.doctors?.profiles?.name ?? '—'}</td>
                    <td>{aff.doctors?.specialization ?? '—'}</td>
                    <td>{aff.doctors?.experience_years ?? 0} yrs</td>
                    <td>{new Date(aff.joined_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
