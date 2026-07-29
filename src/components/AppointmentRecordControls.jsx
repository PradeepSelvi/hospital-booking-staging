import { useState, useEffect } from 'react'
import {
  getGrantForAppointment, grantRecordAccess, revokeRecordAccess,
  getConsultationNote,
} from '../services/medicalHistory'
import { toast } from 'react-toastify'

/**
 * Patient-side controls shown on each appointment card:
 *  - Active appointments: toggle to share medical records with the doctor.
 *  - Completed appointments: read-only consultation notes from the doctor.
 *
 * Props:
 * - appointment: { id, doctor_id, patient_id, status }
 * - patientId: current user's id
 */
export default function AppointmentRecordControls({ appointment, patientId }) {
  const [grant, setGrant] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const isActive = ['PENDING', 'CONFIRMED'].includes(appointment.status)
  const isCompleted = appointment.status === 'COMPLETED'

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        if (isActive) {
          const g = await getGrantForAppointment(appointment.id)
          if (alive) setGrant(g)
        }
        if (isCompleted) {
          const n = await getConsultationNote(appointment.id)
          if (alive) setNote(n)
        }
      } catch { /* non-blocking */ }
    }
    load()
    return () => { alive = false }
  }, [appointment.id, appointment.status])

  async function toggleAccess() {
    try {
      setBusy(true)
      if (grant?.is_active) {
        const updated = await revokeRecordAccess(appointment.id)
        setGrant(updated)
        toast.success('Record access revoked.')
      } else {
        const updated = await grantRecordAccess(appointment.id, patientId, appointment.doctor_id)
        setGrant(updated)
        toast.success('Doctor can now view your medical records for this visit.')
      }
    } catch (err) {
      toast.error(err.message || 'Could not update access.')
    } finally {
      setBusy(false)
    }
  }

  if (isActive) {
    const shared = grant?.is_active
    return (
      <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--radius-md)', background: shared ? 'rgba(34,197,94,0.08)' : 'var(--gray-50)' }}>
        <div className="d-flex align-items-center justify-content-between gap-2">
          <span style={{ fontSize: 13 }}>
            <i className={`bi ${shared ? 'bi-shield-check' : 'bi-shield-lock'} me-1`}
               style={{ color: shared ? '#16A34A' : 'var(--gray-500)' }} />
            {shared ? 'Records shared with this doctor' : 'Share my medical records'}
          </span>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 12, padding: '4px 10px', color: shared ? 'var(--danger)' : 'var(--primary)' }}
            onClick={toggleAccess}
            disabled={busy}
          >
            {busy ? '...' : shared ? 'Revoke' : 'Allow'}
          </button>
        </div>
      </div>
    )
  }

  if (isCompleted && note && (note.advisory || note.prescription || note.follow_up)) {
    return (
      <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--gray-50)' }}>
        <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>
          <i className="bi bi-clipboard2-pulse me-1" style={{ color: 'var(--primary)' }} />
          Doctor's Notes
        </p>
        {note.advisory && <NoteRow label="Advisory" value={note.advisory} />}
        {note.prescription && <NoteRow label="Prescription" value={note.prescription} />}
        {note.follow_up && <NoteRow label="Follow-up" value={note.follow_up} />}
      </div>
    )
  }

  return null
}

function NoteRow({ label, value }) {
  return (
    <p style={{ fontSize: 13, margin: '0 0 6px' }}>
      <span style={{ color: 'var(--gray-500)', fontWeight: 500 }}>{label}: </span>
      <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>
    </p>
  )
}
