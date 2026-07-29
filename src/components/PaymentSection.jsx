import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getPaymentForAppointment, payOnline, payOffline, paiseToRupees } from '../services/payments'
import ReceiptModal from './ReceiptModal'
import { toast } from 'react-toastify'

/**
 * Patient-facing payment block shown on an appointment card.
 *
 * - PENDING payment → amount due + "Pay Online" (Razorpay) and "Pay at Clinic"
 *   (offline). The appointment only completes once payment succeeds.
 * - PAID payment    → confirmation + "View Receipt".
 * - No payment      → renders nothing.
 *
 * Props:
 * - appointment: row incl. doctors.profiles.name
 * - profile: current user's profile (name/email/phone for Razorpay prefill)
 * - onPaid: () => void  (refresh the parent list)
 */
export default function PaymentSection({ appointment, profile, onPaid }) {
  const [payment, setPayment] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)

  const doctorName = appointment.doctors?.profiles?.name || ''

  useEffect(() => {
    let alive = true
    getPaymentForAppointment(appointment.id)
      .then(p => { if (alive) setPayment(p) })
      .catch(() => {})
    return () => { alive = false }
  }, [appointment.id, appointment.status])

  async function refresh() {
    const p = await getPaymentForAppointment(appointment.id)
    setPayment(p)
    return p
  }

  async function handleOnline() {
    try {
      setBusy(true)
      await payOnline({
        appointmentId: appointment.id,
        payment,
        profile: { name: profile?.name, email: profile?.email, phone: profile?.phone },
        doctorName,
      })
      await refresh()
      toast.success('Payment successful. Your appointment is now complete.')
      setShowReceipt(true)
      onPaid?.()
    } catch (err) {
      // Cancellations and gateway failures both arrive here.
      toast.error(err.message || 'Payment was not completed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleOffline() {
    try {
      setBusy(true)
      await payOffline(appointment.id)
      await refresh()
      toast.success('Marked as paid at clinic. Here is your receipt.')
      setShowReceipt(true)
      onPaid?.()
    } catch (err) {
      toast.error(err.message || 'Could not record the payment.')
    } finally {
      setBusy(false)
    }
  }

  if (!payment) return null

  if (payment.status === 'PAID') {
    return (
      <>
        <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--radius-md)', background: 'rgba(34,197,94,0.08)' }}>
          <div className="d-flex align-items-center justify-content-between gap-2">
            <span style={{ fontSize: 13 }}>
              <i className="bi bi-check-circle me-1" style={{ color: '#16A34A' }} />
              Paid ₹{paiseToRupees(payment.amount_paise)} · {payment.method === 'OFFLINE' ? 'Cash' : 'Online'}
            </span>
            <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', color: 'var(--primary)' }}
              onClick={() => setShowReceipt(true)}>
              <i className="bi bi-receipt me-1" />Receipt
            </button>
          </div>
        </div>
        {showReceipt && (
          <ReceiptModal
            payment={payment}
            doctorName={doctorName}
            patientName={profile?.name}
            appointment={appointment}
            onClose={() => setShowReceipt(false)}
          />
        )}
      </>
    )
  }

  // PENDING
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--gray-50)' }}>
      <div className="d-flex align-items-center justify-content-between mb-2">
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          <i className="bi bi-cash-coin me-1" style={{ color: 'var(--primary)' }} />
          Payment due: ₹{paiseToRupees(payment.amount_paise)}
        </span>
      </div>
      <div className="d-flex gap-2 flex-wrap">
        <button className="btn-primary-custom" style={{ fontSize: 13, padding: '8px 14px' }}
          onClick={handleOnline} disabled={busy}>
          <i className="bi bi-credit-card me-1" />Pay Online
        </button>
        <button className="btn-outline-custom" style={{ fontSize: 13, padding: '8px 14px' }}
          onClick={handleOffline} disabled={busy}>
          <i className="bi bi-cash me-1" />Pay at Clinic
        </button>
        <Link to="/complaints" className="btn-ghost" style={{ fontSize: 12, padding: '8px 10px', color: 'var(--gray-500)' }}>
          <i className="bi bi-exclamation-circle me-1" />Payment issue?
        </Link>
      </div>
      <p style={{ fontSize: 11, color: 'var(--gray-400)', margin: '8px 0 0' }}>
        Your appointment completes once payment is received.
      </p>
    </div>
  )
}
