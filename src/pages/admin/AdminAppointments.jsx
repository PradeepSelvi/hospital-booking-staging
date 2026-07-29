import { useState, useEffect } from 'react'
import { getAllAppointments, cancelAppointment } from '../../services/appointments'
import { toast } from 'react-toastify'
import StatusBadge from '../../components/StatusBadge'
import { SkeletonTable } from '../../components/SkeletonLoader'

export default function AdminAppointments() {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [cancelModal, setCancelModal] = useState(null)
  const [cancelReason, setCancelReason] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const data = await getAllAppointments()
      setAppointments(data)
    } catch (err) {
      toast.error('Failed to load appointments')
    } finally {
      setLoading(false)
    }
  }

  async function handleCancel() {
    if (!cancelModal) return
    try {
      await cancelAppointment(cancelModal.id, cancelReason, 'ADMIN')
      toast.success('Appointment cancelled')
      setCancelModal(null)
      setCancelReason('')
      loadData()
    } catch (err) {
      toast.error('Failed to cancel')
    }
  }

  const filtered = appointments.filter(a => {
    if (filterStatus && a.status !== filterStatus) return false
    if (filterDate && a.appointment_date !== filterDate) return false
    return true
  })

  if (loading) return (
    <div>
      <div className="skeleton skeleton-heading" style={{ marginBottom: 'var(--space-4)' }} />
      <div className="skeleton skeleton-text short" style={{ marginBottom: 'var(--space-5)' }} />
      <div className="skeleton" style={{ height: 52, borderRadius: 'var(--card-radius)', marginBottom: 'var(--space-4)' }} />
      <SkeletonTable rows={6} cols={7} />
    </div>
  )

  return (
    <div>
      <div className="mb-4">
        <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
          All Appointments
        </h4>
        <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
          View and manage all hospital appointments
        </p>
      </div>

      {/* Filters */}
      <div className="card-custom p-3 mb-4">
        <div className="d-flex gap-3 align-items-center flex-wrap">
          <select className="form-input-custom" style={{ width: 160, padding: '8px 12px', fontSize: 14 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <input type="date" className="form-input-custom" style={{ width: 170, padding: '8px 12px', fontSize: 14 }} value={filterDate} onChange={e => setFilterDate(e.target.value)} />
          {(filterStatus || filterDate) && (
            <button className="btn-ghost" style={{ fontSize: 13, padding: '8px 14px' }} onClick={() => { setFilterStatus(''); setFilterDate('') }}>
              <i className="bi bi-x-lg me-1" />Clear
            </button>
          )}
          <span style={{ fontSize: 13, color: 'var(--gray-400)', marginLeft: 'auto' }}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="card-custom">
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <i className="bi bi-calendar-x" />
            <p>No appointments found</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table-custom">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(apt => (
                  <tr key={apt.id}>
                    <td style={{ fontWeight: 600, color: 'var(--gray-400)', fontSize: 13 }}>#{apt.id}</td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{apt.profiles?.name ?? '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{apt.profiles?.phone ?? ''}</div>
                    </td>
                    <td style={{ fontWeight: 500, fontSize: 14 }}>
                      Dr. {apt.doctors?.profiles?.name ?? '—'}
                      <div style={{ fontSize: 12, color: 'var(--primary)' }}>{apt.doctors?.specialization ?? ''}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {new Date(apt.appointment_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ fontSize: 13 }}>{apt.slot_start_time?.substring(0, 5)}</td>
                    <td><StatusBadge status={apt.status} /></td>
                    <td>
                      {['PENDING', 'CONFIRMED'].includes(apt.status) && (
                        <button
                          className="btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 12, color: 'var(--danger)' }}
                          onClick={() => setCancelModal(apt)}
                        >
                          <i className="bi bi-x-lg me-1" />Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancel Modal */}
      {cancelModal && (
        <>
          <div className="overlay" onClick={() => setCancelModal(null)} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'white', borderRadius: 'var(--radius-lg)', padding: 32,
            zIndex: 1001, width: '90%', maxWidth: 420, boxShadow: '0 24px 80px rgba(0,0,0,0.2)'
          }}>
            <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 12, color: 'var(--danger)' }}>
              Cancel Appointment #{cancelModal.id}
            </h5>
            <label className="form-label-custom">Reason</label>
            <textarea className="form-input-custom mb-4" rows={3} placeholder="Provide a reason..." value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
            <div className="d-flex gap-3">
              <button className="btn-ghost flex-fill" onClick={() => setCancelModal(null)}>Keep</button>
              <button
                className="flex-fill"
                style={{ background: 'var(--danger)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 'var(--radius-full)', fontWeight: 600, cursor: 'pointer' }}
                onClick={handleCancel}
              >
                Cancel Appointment
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
