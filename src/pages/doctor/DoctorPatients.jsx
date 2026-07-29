import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getDoctorByUserId } from '../../services/doctors'
import { searchDoctorPatients } from '../../services/appointments'
import { getOrCreateConversation } from '../../services/chat'
import { getPatientRecordsForDoctor, groupByCategory, logDocumentAccess } from '../../services/medicalHistory'
import MedicalDocumentUploader from '../../components/MedicalDocumentUploader'
import { SkeletonTable } from '../../components/SkeletonLoader'
import { toast } from 'react-toastify'

export default function DoctorPatients() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [doctorId, setDoctorId] = useState(null)
  const [term, setTerm] = useState('')
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [recordModal, setRecordModal] = useState(null)

  // Resolve the doctor record, then load all their patients once.
  useEffect(() => {
    let alive = true
    async function init() {
      try {
        const doc = await getDoctorByUserId(user.id)
        if (!alive) return
        if (doc) {
          setDoctorId(doc.id)
          const list = await searchDoctorPatients(doc.id, '')
          if (alive) setPatients(list)
        }
      } catch (err) {
        toast.error(err.message || 'Failed to load patients.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    if (user) init()
    return () => { alive = false }
  }, [user])

  const runSearch = useCallback(async (value) => {
    if (!doctorId) return
    try {
      const list = await searchDoctorPatients(doctorId, value)
      setPatients(list)
    } catch (err) {
      toast.error(err.message || 'Search failed.')
    }
  }, [doctorId])

  // Debounce the search as the doctor types.
  useEffect(() => {
    if (!doctorId) return
    const id = setTimeout(() => runSearch(term), 300)
    return () => clearTimeout(id)
  }, [term, doctorId, runSearch])

  async function handleMessage(patient) {
    if (!doctorId) return
    try {
      const conv = await getOrCreateConversation(patient.patient_id, doctorId)
      navigate('/doctor/messages', { state: { conversationId: conv.id } })
    } catch (err) {
      toast.error(err.message || 'Could not open chat.')
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
          My Patients
        </h4>
        <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
          Search the patients you treat by name or mobile number
        </p>
      </div>

      {/* Search */}
      <div className="card-custom p-3 mb-4">
        <div style={{ position: 'relative' }}>
          <i className="bi bi-search" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
          <input
            type="text"
            className="form-input-custom"
            style={{ paddingLeft: 38 }}
            placeholder="Search by patient name or mobile number..."
            value={term}
            onChange={e => setTerm(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      {/* Results */}
      <div className="card-custom">
        {loading ? (
          <SkeletonTable rows={6} cols={5} />
        ) : patients.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <i className="bi bi-person-x" />
            <p>{term ? 'No patients match your search.' : 'You have no patients yet.'}</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table-custom">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Mobile</th>
                  <th>Visits</th>
                  <th>Last Visit</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {patients.map(p => (
                  <tr key={p.patient_id}>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                          {p.name?.charAt(0)?.toUpperCase() ?? 'P'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name || 'Patient'}</div>
                          <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{p.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 14 }}>{p.phone || '—'}</td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{p.totalVisits}</span>
                      {p.upcoming > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--primary)', marginLeft: 6 }}>
                          ({p.upcoming} upcoming)
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {p.lastVisit
                        ? new Date(p.lastVisit + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </td>
                    <td>
                      <button
                        className="btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 12, color: 'var(--primary)' }}
                        onClick={() => setRecordModal(p)}
                      >
                        <i className="bi bi-file-medical" /> Records
                      </button>
                      <button
                        className="btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 12, color: 'var(--primary)' }}
                        onClick={() => handleMessage(p)}
                      >
                        <i className="bi bi-chat-dots" /> Message
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {recordModal && (
        <PatientRecordsModal patient={recordModal} onClose={() => setRecordModal(null)} />
      )}
    </div>
  )
}

/**
 * Read-only view of a patient's shared medical records. RLS returns data only
 * if the patient granted access for a non-cancelled appointment; otherwise we
 * show a "not shared" notice.
 */
function PatientRecordsModal({ patient, onClose }) {
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState(null)
  const [grouped, setGrouped] = useState({ SHEET: [], SCAN: [], OTHER: [] })
  const [hasAccess, setHasAccess] = useState(false)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const { history: h, documents } = await getPatientRecordsForDoctor(patient.patient_id)
        if (!alive) return
        setHistory(h)
        setGrouped(groupByCategory(documents))
        setHasAccess(Boolean(h) || documents.length > 0)
      } catch (err) {
        toast.error(err.message || 'Could not load records.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [patient.patient_id])

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: 'white', borderRadius: 'var(--radius-lg)', padding: 0,
        zIndex: 1001, width: '94%', maxWidth: 680, maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.2)'
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--gray-200)', position: 'sticky', top: 0, background: 'white', zIndex: 2 }}>
          <div className="d-flex align-items-center justify-content-between">
            <h5 style={{ fontWeight: 700, margin: 0 }}>{patient.name || 'Patient'} — Records</h5>
            <button className="btn-ghost" style={{ padding: '4px 10px' }} onClick={onClose} aria-label="Close">
              <i className="bi bi-x-lg" />
            </button>
          </div>
        </div>
        <div style={{ padding: 24 }}>
          {loading ? (
            <div className="text-center py-4"><div className="spinner-custom" /></div>
          ) : !hasAccess ? (
            <div className="alert-custom" style={{ padding: '10px 14px', fontSize: 13, background: 'var(--gray-50)', borderRadius: 'var(--radius-md)' }}>
              <i className="bi bi-shield-lock me-1" />
              This patient has not shared their medical records with you. They can grant access from their appointment.
            </div>
          ) : (
            <>
              {history && (
                <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 12 }}>
                  {history.medical_summary && <Row label="Summary" value={history.medical_summary} />}
                  {history.previous_concerns && <Row label="Previous concerns" value={history.previous_concerns} />}
                  {history.current_medications && <Row label="Medications" value={history.current_medications} />}
                  {history.allergies && <Row label="Allergies" value={history.allergies} />}
                  {history.chronic_conditions && <Row label="Chronic conditions" value={history.chronic_conditions} />}
                  {history.other_info && <Row label="Other" value={history.other_info} />}
                </div>
              )}
              <MedicalDocumentUploader grouped={grouped} readOnly onView={(doc) => logDocumentAccess(doc.id)} />
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Row({ label, value }) {
  return (
    <p style={{ fontSize: 13, margin: '0 0 6px' }}>
      <span style={{ color: 'var(--gray-500)', fontWeight: 500 }}>{label}: </span>
      <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>
    </p>
  )
}
