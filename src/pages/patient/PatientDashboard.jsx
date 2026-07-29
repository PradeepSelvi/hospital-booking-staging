import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getPatientAppointments } from '../../services/appointments'
import { useAuth } from '../../context/AuthContext'
import { toast } from 'react-toastify'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import StatusBadge from '../../components/StatusBadge'
import { SkeletonKPI, SkeletonTable } from '../../components/SkeletonLoader'

export default function PatientDashboard() {
  const { t, i18n } = useTranslation('patient')
  const { user, profile } = useAuth()
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData() {
    try {
      setLoading(true)
      const data = await getPatientAppointments(user.id)
      setAppointments(data)
    } catch (err) {
      toast.error(t('dashboard.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const today = new Date().toISOString().split('T')[0]
  const upcoming = appointments.filter(a => ['PENDING', 'CONFIRMED'].includes(a.status) && a.appointment_date >= today)
  const completed = appointments.filter(a => a.status === 'COMPLETED')
  const nextAppointment = upcoming[0]

  if (loading) return (
    <div>
      <Navbar />
      <div className="page-header"><div className="container"><div className="skeleton skeleton-heading" style={{ background: 'rgba(255,255,255,0.15)', marginBottom: 8 }} /><div className="skeleton skeleton-text short" style={{ background: 'rgba(255,255,255,0.1)' }} /></div></div>
      <div className="container py-5">
        <SkeletonKPI count={3} />
        <div className="row g-4 mt-3">
          <div className="col-lg-6"><div className="skeleton" style={{ height: 200, borderRadius: 'var(--card-radius)' }} /></div>
          <div className="col-lg-6"><div className="skeleton" style={{ height: 200, borderRadius: 'var(--card-radius)' }} /></div>
        </div>
        <div className="mt-4"><SkeletonTable rows={4} cols={4} /></div>
      </div>
      <Footer />
    </div>
  )

  return (
    <div>
      <Navbar />

      <div className="page-header">
        <div className="container">
          <h1 style={{ fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', color: 'white', fontFamily: 'var(--font-display)', position: 'relative', zIndex: 1 }}>
            {t('dashboard.welcome', { name: profile?.name?.split(' ')[0] ?? t('dashboard.patientFallback') })}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: 6, fontSize: 15, position: 'relative', zIndex: 1 }}>
            {t('dashboard.subtitle')}
          </p>
        </div>
      </div>

      <div className="container py-5">
        {/* Stats */}
        <div className="row g-3 mb-5 stagger-children">
          {[
            { icon: 'bi-calendar-check', value: appointments.length, label: t('dashboard.totalAppointments'), color: 'var(--primary)', bg: 'rgba(0,119,182,0.1)' },
            { icon: 'bi-clock', value: upcoming.length, label: t('dashboard.upcoming'), color: 'var(--warning)', bg: 'rgba(249,199,79,0.1)' },
            { icon: 'bi-check-circle', value: completed.length, label: t('dashboard.completed'), color: 'var(--success)', bg: 'rgba(45,198,83,0.1)' },
          ].map((stat, i) => (
            <div key={i} className="col-md-4">
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

        <div className="row g-4">
          {/* Next Appointment */}
          <div className="col-lg-6">
            <div className="card-custom p-4 h-100">
              <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
                <i className="bi bi-star me-2 text-primary" />{t('dashboard.nextAppointment')}
              </h6>
              {nextAppointment ? (
                <div>
                  <div className="d-flex align-items-center gap-3 mb-3">
                    <div className="avatar" style={{ width: 52, height: 52, fontSize: 18 }}>
                      {nextAppointment.doctors?.profiles?.name?.charAt(0) ?? 'D'}
                    </div>
                    <div>
                      <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0 }}>
                        Dr. {nextAppointment.doctors?.profiles?.name ?? t('dashboard.doctorFallback')}
                      </h6>
                      <span style={{ fontSize: 13, color: 'var(--primary)' }}>
                        {nextAppointment.doctors?.specialization}
                      </span>
                    </div>
                    <div className="ms-auto">
                      <StatusBadge status={nextAppointment.status} />
                    </div>
                  </div>
                  <div style={{ background: 'var(--gray-50)', padding: 16, borderRadius: 'var(--radius-md)' }}>
                    <div className="d-flex gap-4">
                      <div className="d-flex align-items-center gap-2">
                        <i className="bi bi-calendar3" style={{ color: 'var(--primary)' }} />
                        <span style={{ fontSize: 14 }}>
                          {new Date(nextAppointment.appointment_date + 'T00:00:00').toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <i className="bi bi-clock" style={{ color: 'var(--primary)' }} />
                        <span style={{ fontSize: 14 }}>{nextAppointment.slot_start_time?.substring(0, 5)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <i className="bi bi-calendar-x" style={{ fontSize: 40, color: 'var(--gray-300)', display: 'block', marginBottom: 12 }} />
                  <p style={{ color: 'var(--gray-500)', fontSize: 14 }}>{t('dashboard.noUpcoming')}</p>
                  <Link to="/doctors" className="btn-primary-custom mt-2" style={{ padding: '8px 20px', fontSize: 13 }}>
                    {t('dashboard.findADoctor')}
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="col-lg-6">
            <div className="card-custom p-4 h-100">
              <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
                <i className="bi bi-lightning me-2 text-primary" />{t('dashboard.quickActions')}
              </h6>
              <div className="d-flex flex-column gap-3">
                {[
                  { to: '/doctors', icon: 'bi-search', label: t('dashboard.findADoctor'), desc: t('dashboard.browseSpecialists'), color: 'var(--primary)' },
                  { to: '/patient/appointments', icon: 'bi-calendar2-check', label: t('dashboard.myAppointments'), desc: t('dashboard.viewAllBookings'), color: 'var(--success)' },
                  { to: '/patient/profile', icon: 'bi-person-circle', label: t('dashboard.myProfile'), desc: t('dashboard.editYourDetails'), color: 'var(--info)' },
                ].map((action, i) => (
                  <Link
                    key={i}
                    to={action.to}
                    className="d-flex align-items-center gap-3 p-3"
                    style={{
                      background: 'var(--gray-50)', borderRadius: 'var(--radius-md)',
                      textDecoration: 'none', transition: 'var(--transition)',
                      border: '1px solid transparent'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gray-200)'; e.currentTarget.style.background = 'white' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'var(--gray-50)' }}
                  >
                    <div style={{
                      width: 44, height: 44, borderRadius: 'var(--radius-md)',
                      background: `${action.color}15`, display: 'flex',
                      alignItems: 'center', justifyContent: 'center'
                    }}>
                      <i className={`bi ${action.icon}`} style={{ fontSize: 20, color: action.color }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--dark)' }}>{action.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{action.desc}</div>
                    </div>
                    <i className="bi bi-chevron-right ms-auto" style={{ color: 'var(--gray-300)' }} />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Recent Appointments */}
        {appointments.length > 0 && (
          <div className="card-custom p-4 mt-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0 }}>
                <i className="bi bi-clock-history me-2 text-primary" />{t('dashboard.recentAppointments')}
              </h6>
              <Link to="/patient/appointments" style={{ fontSize: 13, fontWeight: 600 }}>
                {t('dashboard.viewAll')} <i className="bi bi-arrow-right" />
              </Link>
            </div>
            <div className="table-responsive">
              <table className="table-custom">
                <thead>
                  <tr>
                    <th>{t('dashboard.doctor')}</th>
                    <th>{t('dashboard.date')}</th>
                    <th>{t('dashboard.time')}</th>
                    <th>{t('dashboard.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.slice(0, 5).map(apt => (
                    <tr key={apt.id}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                            {apt.doctors?.profiles?.name?.charAt(0) ?? 'D'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>Dr. {apt.doctors?.profiles?.name ?? t('dashboard.doctorFallback')}</div>
                            <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{apt.doctors?.specialization}</div>
                          </div>
                        </div>
                      </td>
                      <td>{new Date(apt.appointment_date + 'T00:00:00').toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })}</td>
                      <td>{apt.slot_start_time?.substring(0, 5)}</td>
                      <td><StatusBadge status={apt.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  )
}
