import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'
import { closeMyAccount } from '../services/profiles'

const ROLE_COPY = {
  PATIENT: 'You will lose access to your appointments and booking history.',
  DOCTOR: 'Your profile will be removed from the directory, your hospital affiliations will be deactivated, and patients will no longer be able to book you.',
  HOSPITAL: 'Your hospital will be removed from the directory and hidden from patients and doctors.',
}

const CONFIRM_WORD = 'CLOSE'

/**
 * Self-service "Account Closure" danger-zone card + confirmation modal.
 * Used by patient, doctor, and hospital profile pages.
 */
export default function AccountClosure({ role = 'PATIENT' }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')
  const [closing, setClosing] = useState(false)

  function openModal() {
    setConfirmText('')
    setReason('')
    setShowModal(true)
  }

  async function handleClose() {
    if (confirmText.trim().toUpperCase() !== CONFIRM_WORD) {
      toast.error(`Please type ${CONFIRM_WORD} to confirm`)
      return
    }
    try {
      setClosing(true)
      await closeMyAccount(reason.trim() || null)
      toast.success('Your account has been closed. You are being signed out.')
      // Sign out and return to the landing page.
      try { await signOut() } catch { /* ignore */ }
      setTimeout(() => { window.location.href = '/' }, 1200)
    } catch (err) {
      toast.error(err.message || 'Failed to close account. Please try again.')
      setClosing(false)
    }
  }

  return (
    <>
      <div className="card-custom p-4 mt-3" style={{ border: '1px solid rgba(239,35,60,0.25)', background: 'rgba(239,35,60,0.03)' }}>
        <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--danger)', marginBottom: 8 }}>
          <i className="bi bi-exclamation-octagon me-2" />
          Account Closure
        </h6>
        <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 6, lineHeight: 1.7 }}>
          Closing your account will deactivate it and sign you out. {ROLE_COPY[role] || ROLE_COPY.PATIENT}
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--gray-400)', marginBottom: 16 }}>
          Your data is preserved. To reopen a closed account, contact support.
        </p>
        <button
          type="button"
          className="btn-ghost"
          style={{ color: 'var(--danger)', border: '1px solid rgba(239,35,60,0.3)', background: 'rgba(239,35,60,0.06)' }}
          onClick={openModal}
        >
          <i className="bi bi-power me-1" /> Close My Account
        </button>
      </div>

      {showModal && (
        <>
          <div className="overlay" onClick={() => !closing && setShowModal(false)} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'white', borderRadius: 'var(--radius-lg)', padding: 32,
            zIndex: 1001, width: '90%', maxWidth: 460, boxShadow: '0 24px 80px rgba(0,0,0,0.2)'
          }}>
            <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 8, color: 'var(--danger)' }}>
              <i className="bi bi-exclamation-octagon me-2" />Close Your Account?
            </h5>
            <p style={{ fontSize: 13.5, color: 'var(--gray-600)', lineHeight: 1.7, marginBottom: 18 }}>
              This will deactivate your account and immediately sign you out. {ROLE_COPY[role] || ROLE_COPY.PATIENT}
            </p>

            <div className="mb-3">
              <label className="form-label-custom">Reason (optional)</label>
              <textarea
                className="form-input-custom"
                rows={2}
                value={reason}
                onChange={e => setReason(e.target.value)}
                maxLength={500}
                placeholder="Let us know why you're leaving..."
                disabled={closing}
              />
            </div>

            <div className="mb-4">
              <label className="form-label-custom">
                Type <strong>{CONFIRM_WORD}</strong> to confirm
              </label>
              <input
                type="text"
                className="form-input-custom"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={CONFIRM_WORD}
                disabled={closing}
                autoFocus
              />
            </div>

            <div className="d-flex gap-3">
              <button
                type="button"
                className="btn-ghost flex-fill justify-content-center"
                onClick={() => setShowModal(false)}
                disabled={closing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary-custom flex-fill justify-content-center"
                style={{ background: 'var(--danger)' }}
                onClick={handleClose}
                disabled={closing || confirmText.trim().toUpperCase() !== CONFIRM_WORD}
              >
                {closing ? (
                  <><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> Closing...</>
                ) : (
                  <><i className="bi bi-power me-1" />Close Account</>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
