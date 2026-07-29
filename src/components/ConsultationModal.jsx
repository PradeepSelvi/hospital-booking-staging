import { useState, useEffect } from 'react'
import {
  getPatientRecordsForDoctor, groupByCategory,
  getConsultationNote, saveConsultationNote, logDocumentAccess,
} from '../services/medicalHistory'
import { getPaymentForAppointment, requestAppointmentPayment, paiseToRupees } from '../services/payments'
import MedicalDocumentUploader from './MedicalDocumentUploader'
import PrescriptionEditor from './PrescriptionEditor'
import { toast } from 'react-toastify'

/**
 * Doctor-side consultation panel for an appointment.
 *  - Shows the patient's medical history + documents IF the patient granted
 *    access (RLS returns nothing otherwise → we show a "not shared" notice).
 *  - Lets the doctor record closing notes (advisory / prescription / follow-up)
 *    and complete the appointment in one action.
 *
 * Props:
 * - appointment: { id, doctor_id, patient_id, profiles?: { name } }
 * - onClose: () => void
 * - onCompleted: () => void   (refresh parent list)
 */
export default function ConsultationModal({ appointment, onClose, onCompleted }) {
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState(null)
  const [grouped, setGrouped] = useState({ SHEET: [], SCAN: [], OTHER: [] })
  const [hasAccess, setHasAccess] = useState(false)
  const [note, setNote] = useState({ advisory: '', prescription: '', follow_up: '' })
  const [saving, setSaving] = useState(false)
  const [amount, setAmount] = useState('')
  const [payment, setPayment] = useState(null)

  const isActive = ['PENDING', 'CONFIRMED'].includes(appointment.status)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        setLoading(true)
        const [{ history: h, documents }, existingNote, existingPayment] = await Promise.all([
          getPatientRecordsForDoctor(appointment.patient_id),
          getConsultationNote(appointment.id),
          getPaymentForAppointment(appointment.id),
        ])
        if (!alive) return
        setHistory(h)
        setGrouped(groupByCategory(documents))
        setHasAccess(Boolean(h) || documents.length > 0)
        if (existingNote) {
          setNote({
            advisory: existingNote.advisory || '',
            prescription: existingNote.prescription || '',
            follow_up: existingNote.follow_up || '',
          })
        }
        if (existingPayment) {
          setPayment(existingPayment)
          setAmount(paiseToRupees(existingPayment.amount_paise))
        }
      } catch (err) {
        toast.error(err.message || 'Could not load patient records.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [appointment.id, appointment.patient_id])

  async function persistNote() {
    return saveConsultationNote(appointment.id, appointment.doctor_id, appointment.patient_id, note)
  }

  async function handleSaveOnly() {
    try {
      setSaving(true)
      await persistNote()
      toast.success('Notes saved.')
      onCompleted?.()
    } catch (err) {
      toast.error(err.message || 'Could not save notes.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRequestPayment() {
    const rupees = Number(amount)
    if (!Number.isFinite(rupees) || rupees < 1) {
      toast.error('Enter a valid consultation amount (at least ₹1).')
      return
    }
    try {
      setSaving(true)
      await persistNote()
      const p = await requestAppointmentPayment(appointment.id, rupees)
      setPayment(p)
      toast.success('Payment requested. The patient can now pay to complete the visit.')
      onCompleted?.()
      onClose?.()
    } catch (err) {
      toast.error(err.message || 'Could not request payment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: 'white', borderRadius: 'var(--radius-lg)', padding: 0,
        zIndex: 1001, width: '94%', maxWidth: 720, maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.2)'
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--gray-200)', position: 'sticky', top: 0, background: 'white', zIndex: 2 }}>
          <div className="d-flex align-items-center justify-content-between">
            <h5 style={{ fontWeight: 700, margin: 0 }}>
              Consultation — {appointment.profiles?.name ?? 'Patient'}
            </h5>
            <button className="btn-ghost" style={{ padding: '4px 10px' }} onClick={onClose} aria-label="Close">
              <i className="bi bi-x-lg" />
            </button>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {loading ? (
            <div className="text-center py-4"><div className="spinner-custom" /></div>
          ) : (
            <>
              {/* Patient records */}
              <h6 style={{ fontWeight: 600 }}>Patient Medical Records</h6>
              {!hasAccess ? (
                <div className="alert-custom" style={{ padding: '10px 14px', fontSize: 13, background: 'var(--gray-50)', borderRadius: 'var(--radius-md)' }}>
                  <i className="bi bi-shield-lock me-1" />
                  This patient has not shared their medical records for this appointment.
                </div>
              ) : (
                <div className="mb-3">
                  {history && (
                    <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 12 }}>
                      {history.medical_summary && <RecRow label="Summary" value={history.medical_summary} />}
                      {history.previous_concerns && <RecRow label="Previous concerns" value={history.previous_concerns} />}
                      {history.current_medications && <RecRow label="Medications" value={history.current_medications} />}
                      {history.allergies && <RecRow label="Allergies" value={history.allergies} />}
                      {history.chronic_conditions && <RecRow label="Chronic conditions" value={history.chronic_conditions} />}
                      {history.other_info && <RecRow label="Other" value={history.other_info} />}
                    </div>
                  )}
                  <MedicalDocumentUploader grouped={grouped} readOnly onView={(doc) => logDocumentAccess(doc.id)} />
                </div>
              )}

              {/* Closing notes */}
              <h6 style={{ fontWeight: 600, marginTop: 16 }}>Closing Notes</h6>
              <div className="mb-3">
                <label className="form-label-custom">Medical Advisory</label>
                <textarea className="form-input-custom" rows={2} maxLength={2000}
                  placeholder="Advice given to the patient..."
                  value={note.advisory}
                  onChange={e => setNote(p => ({ ...p, advisory: e.target.value }))} />
              </div>
              <div className="mb-3">
                <label className="form-label-custom">Prescription / Instructions</label>
                <textarea className="form-input-custom" rows={2} maxLength={2000}
                  placeholder="Medicines, dosage, instructions..."
                  value={note.prescription}
                  onChange={e => setNote(p => ({ ...p, prescription: e.target.value }))} />
              </div>
              <div className="mb-3">
                <label className="form-label-custom">Queries / Follow-up</label>
                <textarea className="form-input-custom" rows={2} maxLength={2000}
                  placeholder="Follow-up plan, tests to do, next visit..."
                  value={note.follow_up}
                  onChange={e => setNote(p => ({ ...p, follow_up: e.target.value }))} />
              </div>

              {/* Structured prescription */}
              <h6 style={{ fontWeight: 600, marginTop: 16 }}>Prescription</h6>
              <p style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: -4, marginBottom: 10 }}>
                Issue a structured, itemized prescription. The patient can view and download it.
              </p>
              <div className="mb-3">
                <PrescriptionEditor appointment={appointment} />
              </div>

              {/* Billing / payment */}
              <h6 style={{ fontWeight: 600, marginTop: 16 }}>Consultation Charge</h6>
              {payment?.status === 'PAID' ? (
                <div className="alert-custom" style={{ padding: '10px 14px', fontSize: 13, background: 'rgba(34,197,94,0.08)', borderRadius: 'var(--radius-md)' }}>
                  <i className="bi bi-check-circle me-1" style={{ color: '#16A34A' }} />
                  Paid ₹{paiseToRupees(payment.amount_paise)} ({payment.method === 'OFFLINE' ? 'cash' : 'online'})
                  {payment.receipt_number ? ` — ${payment.receipt_number}` : ''}
                </div>
              ) : (
                <>
                  <div className="mb-2">
                    <label className="form-label-custom">Amount (₹)</label>
                    <input
                      type="number" min="1" step="0.01"
                      className="form-input-custom"
                      placeholder="e.g. 500"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      style={{ maxWidth: 200 }}
                    />
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: 0 }}>
                    The patient chooses online or offline payment. The visit is marked
                    completed only after payment.
                    {payment ? ' A payment request already exists; saving updates the amount.' : ''}
                  </p>
                </>
              )}

              <div className="d-flex gap-3 mt-4">
                <button className="btn-ghost flex-fill" onClick={handleSaveOnly} disabled={saving}>
                  Save Notes
                </button>
                {isActive && payment?.status !== 'PAID' && (
                  <button className="btn-primary-custom flex-fill" onClick={handleRequestPayment} disabled={saving}>
                    {saving ? 'Saving...' : 'Save & Request Payment'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function RecRow({ label, value }) {
  return (
    <p style={{ fontSize: 13, margin: '0 0 6px' }}>
      <span style={{ color: 'var(--gray-500)', fontWeight: 500 }}>{label}: </span>
      <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>
    </p>
  )
}
