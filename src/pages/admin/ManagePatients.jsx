import { useState, useEffect } from 'react'
import { getAllPatients } from '../../services/admin'
import { getPatientAppointments } from '../../services/appointments'
import { toast } from 'react-toastify'
import StatusBadge from '../../components/StatusBadge'
import { SkeletonTable, SkeletonAppointmentCards, SkeletonFullPage } from '../../components/SkeletonLoader'

export default function ManagePatients() {
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [patientApts, setPatientApts] = useState([])
  const [aptsLoading, setAptsLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const data = await getAllPatients()
      setPatients(data)
    } catch (err) {
      toast.error('Failed to load patients')
    } finally {
      setLoading(false)
    }
  }

  async function viewPatient(patient) {
    setSelected(patient)
    try {
      setAptsLoading(true)
      const apts = await getPatientAppointments(patient.id)
      setPatientApts(apts)
    } catch (err) {
      setPatientApts([])
    } finally {
      setAptsLoading(false)
    }
  }

  const filtered = patients.filter(p => {
    if (!search) return true
    const name = p.name?.toLowerCase() ?? ''
    const email = p.email?.toLowerCase() ?? ''
    return name.includes(search.toLowerCase()) || email.includes(search.toLowerCase())
  })

  if (loading) return (
    <div>
      <div className="skeleton skeleton-heading" style={{ marginBottom: 'var(--space-4)' }} />
      <div className="skeleton skeleton-text short" style={{ marginBottom: 'var(--space-5)' }} />
      <div className="skeleton" style={{ height: 52, borderRadius: 'var(--card-radius)', marginBottom: 'var(--space-4)' }} />
      <SkeletonTable rows={6} cols={5} />
    </div>
  )

  return (
    <div>
      <div className="mb-4">
        <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
          Patients
        </h4>
        <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
          View all registered patients and their appointment history
        </p>
      </div>

      {/* Search */}
      <div className="card-custom p-3 mb-4">
        <div className="d-flex align-items-center gap-3">
          <div className="search-input-wrapper flex-fill">
            <i className="bi bi-search" />
            <input
              type="text"
              className="form-input-custom"
              placeholder="Search by name or email..."
              style={{ paddingLeft: 42 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span style={{ fontSize: 13, color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>
            {filtered.length} patient{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="card-custom">
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <i className="bi bi-person-x" />
            <p>No patients found</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table-custom">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Joined</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                          {p.name?.charAt(0) ?? 'P'}
                        </div>
                        <span style={{ fontWeight: 600 }}>{p.name ?? '—'}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--gray-500)' }}>{p.email ?? '—'}</td>
                    <td style={{ fontSize: 13 }}>{p.phone ?? '—'}</td>
                    <td style={{ fontSize: 13, color: 'var(--gray-400)' }}>
                      {p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td>
                      <button
                        className="btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => viewPatient(p)}
                      >
                        <i className="bi bi-eye me-1" />View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Patient Detail Modal */}
      {selected && (
        <>
          <div className="overlay" onClick={() => setSelected(null)} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'white', borderRadius: 'var(--radius-lg)', padding: 32,
            zIndex: 1001, width: '90%', maxWidth: 600, maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 24px 80px rgba(0,0,0,0.2)'
          }}>
            <div className="d-flex justify-content-between align-items-start mb-4">
              <div className="d-flex align-items-center gap-3">
                <div className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
                  {selected.name?.charAt(0) ?? 'P'}
                </div>
                <div>
                  <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0 }}>{selected.name}</h5>
                  <p style={{ fontSize: 13, color: 'var(--gray-400)', margin: 0 }}>{selected.email}</p>
                </div>
              </div>
              <button className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setSelected(null)}>
                <i className="bi bi-x-lg" />
              </button>
            </div>

            <div className="d-flex gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
              <div style={{ background: 'var(--gray-50)', padding: '8px 16px', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Phone</span>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{selected.phone ?? '—'}</p>
              </div>
              <div style={{ background: 'var(--gray-50)', padding: '8px 16px', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Total Appointments</span>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{patientApts.length}</p>
              </div>
            </div>

            <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 12 }}>
              Appointment History
            </h6>
            {aptsLoading ? (
              <SkeletonTable rows={3} cols={3} />
            ) : patientApts.length === 0 ? (
              <p style={{ fontSize: 14, color: 'var(--gray-400)' }}>No appointments found</p>
            ) : (
              <div className="table-responsive">
                <table className="table-custom">
                  <thead>
                    <tr>
                      <th>Doctor</th>
                      <th>Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patientApts.slice(0, 10).map(apt => (
                      <tr key={apt.id}>
                        <td style={{ fontWeight: 500, fontSize: 13 }}>Dr. {apt.doctors?.profiles?.name ?? '—'}</td>
                        <td style={{ fontSize: 13 }}>
                          {new Date(apt.appointment_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td><StatusBadge status={apt.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
