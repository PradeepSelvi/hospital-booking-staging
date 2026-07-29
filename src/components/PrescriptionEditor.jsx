import { useState, useEffect, useCallback } from 'react'
import { toast } from 'react-toastify'
import {
  MED_FORMS,
  issuePrescription,
  cancelPrescription,
  getPrescriptionForAppointment,
} from '../services/prescriptions'

const EMPTY_ITEM = {
  drug_name: '', form: '', strength: '', dosage: '',
  frequency: '', duration: '', quantity: '', instructions: '', is_controlled: false,
}

/**
 * Doctor-side structured prescription authoring for one appointment.
 * Loads any existing prescription; when ISSUED it shows a read-only summary
 * with a Cancel action and the option to replace it with a new one.
 *
 * Props:
 * - appointment: { id, status }
 * - onChanged?: () => void
 */
export default function PrescriptionEditor({ appointment, onChanged }) {
  const [loading, setLoading] = useState(true)
  const [existing, setExisting] = useState(null)
  const [editing, setEditing] = useState(false)
  const [diagnosis, setDiagnosis] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [items, setItems] = useState([{ ...EMPTY_ITEM }])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const rx = await getPrescriptionForAppointment(appointment.id)
      setExisting(rx && rx.status !== 'CANCELLED' ? rx : null)
      setEditing(!rx || rx.status === 'CANCELLED')
    } catch {
      setEditing(true)
    } finally {
      setLoading(false)
    }
  }, [appointment.id])

  useEffect(() => { load() }, [load])

  function updateItem(idx, patch) {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  function addItem() {
    setItems(prev => [...prev, { ...EMPTY_ITEM }])
  }
  function removeItem(idx) {
    setItems(prev => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  async function handleIssue() {
    try {
      setBusy(true)
      await issuePrescription(appointment.id, {
        diagnosis,
        validUntil: validUntil || null,
        items,
      })
      toast.success('Prescription issued. The patient has been notified.')
      setDiagnosis('')
      setValidUntil('')
      setItems([{ ...EMPTY_ITEM }])
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err.message || 'Could not issue the prescription.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (!existing) return
    const reason = window.prompt('Reason for cancelling this prescription (optional):', '')
    if (reason === null) return
    try {
      setBusy(true)
      await cancelPrescription(existing.id, reason)
      toast.success('Prescription cancelled.')
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err.message || 'Could not cancel the prescription.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="text-center py-3"><div className="spinner-custom" /></div>
  }

  // ── Read-only summary of an issued prescription ──
  if (existing && !editing) {
    const its = existing.prescription_items || []
    return (
      <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', padding: 14 }}>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>
            <i className="bi bi-check-circle me-1" /> Prescription issued
          </span>
          <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
            {existing.issued_at ? new Date(existing.issued_at).toLocaleDateString() : ''}
          </span>
        </div>
        {existing.diagnosis && (
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>
            <span style={{ color: 'var(--gray-500)', fontWeight: 500 }}>Diagnosis: </span>{existing.diagnosis}
          </p>
        )}
        <ol style={{ paddingLeft: 18, margin: 0 }}>
          {its.map(it => (
            <li key={it.id} style={{ fontSize: 13, marginBottom: 6 }}>
              <strong>{it.drug_name}</strong>
              {it.strength ? ` ${it.strength}` : ''}{it.form ? ` (${it.form})` : ''}
              {it.is_controlled && <span className="badge bg-warning text-dark ms-1" style={{ fontSize: 10 }}>Controlled</span>}
              <br />
              <span style={{ color: 'var(--gray-600)' }}>
                {it.dosage} · {it.frequency} · {it.duration}
                {it.quantity ? ` · Qty ${it.quantity}` : ''}
              </span>
              {it.instructions && <><br /><em style={{ color: 'var(--gray-500)' }}>{it.instructions}</em></>}
            </li>
          ))}
        </ol>
        <div className="d-flex gap-2 mt-3">
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={handleCancel} disabled={busy}>
            <i className="bi bi-x-circle me-1" /> Cancel Rx
          </button>
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => setEditing(true)} disabled={busy}>
            <i className="bi bi-pencil me-1" /> Replace
          </button>
        </div>
      </div>
    )
  }

  // ── Editor ──
  return (
    <div>
      <div className="row g-2 mb-3">
        <div className="col-md-8">
          <label className="form-label-custom">Diagnosis (optional)</label>
          <input className="form-input-custom" maxLength={500}
            placeholder="e.g. Acute bronchitis"
            value={diagnosis} onChange={e => setDiagnosis(e.target.value)} />
        </div>
        <div className="col-md-4">
          <label className="form-label-custom">Valid until (optional)</label>
          <input type="date" className="form-input-custom"
            value={validUntil} onChange={e => setValidUntil(e.target.value)} />
        </div>
      </div>

      {items.map((it, idx) => (
        <div key={idx} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 10 }}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)' }}>Medication {idx + 1}</span>
            {items.length > 1 && (
              <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
                onClick={() => removeItem(idx)} aria-label="Remove medication">
                <i className="bi bi-trash" />
              </button>
            )}
          </div>
          <div className="row g-2">
            <div className="col-md-6">
              <input className="form-input-custom" placeholder="Drug name *" maxLength={200}
                value={it.drug_name} onChange={e => updateItem(idx, { drug_name: e.target.value })} />
            </div>
            <div className="col-md-3">
              <select className="form-input-custom" value={it.form}
                onChange={e => updateItem(idx, { form: e.target.value })}>
                <option value="">Form</option>
                {MED_FORMS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <input className="form-input-custom" placeholder="Strength" maxLength={60}
                value={it.strength} onChange={e => updateItem(idx, { strength: e.target.value })} />
            </div>
            <div className="col-md-3">
              <input className="form-input-custom" placeholder="Dosage *" maxLength={120}
                value={it.dosage} onChange={e => updateItem(idx, { dosage: e.target.value })} />
            </div>
            <div className="col-md-3">
              <input className="form-input-custom" placeholder="Frequency *" maxLength={120}
                value={it.frequency} onChange={e => updateItem(idx, { frequency: e.target.value })} />
            </div>
            <div className="col-md-3">
              <input className="form-input-custom" placeholder="Duration *" maxLength={120}
                value={it.duration} onChange={e => updateItem(idx, { duration: e.target.value })} />
            </div>
            <div className="col-md-3">
              <input type="number" min="1" className="form-input-custom" placeholder="Qty"
                value={it.quantity} onChange={e => updateItem(idx, { quantity: e.target.value })} />
            </div>
            <div className="col-12">
              <input className="form-input-custom" placeholder="Instructions (e.g. after food)" maxLength={500}
                value={it.instructions} onChange={e => updateItem(idx, { instructions: e.target.value })} />
            </div>
            <div className="col-12">
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={it.is_controlled}
                  onChange={e => updateItem(idx, { is_controlled: e.target.checked })} />
                Controlled medication (requires MFA to issue)
              </label>
            </div>
          </div>
        </div>
      ))}

      <div className="d-flex gap-2 mt-2">
        <button className="btn-ghost" style={{ fontSize: 13 }} onClick={addItem} disabled={busy}>
          <i className="bi bi-plus-lg me-1" /> Add medication
        </button>
        <button className="btn-primary-custom ms-auto" onClick={handleIssue} disabled={busy}>
          {busy ? 'Issuing...' : (existing ? 'Replace & Issue' : 'Issue Prescription')}
        </button>
        {existing && (
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => setEditing(false)} disabled={busy}>
            Back
          </button>
        )}
      </div>
    </div>
  )
}
