import { useState, useEffect } from 'react'
import { getDoctors } from '../services/doctors'
import { toast } from 'react-toastify'

/**
 * Patient-side picker to start a new chat with any doctor.
 *
 * Props:
 * - onPick: (doctorId) => void   called when a doctor is chosen
 * - onClose: () => void
 */
export default function NewConversationModal({ onPick, onClose }) {
  const [term, setTerm] = useState('')
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const id = setTimeout(async () => {
      try {
        setLoading(true)
        const list = await getDoctors(term ? { search: term } : {})
        if (alive) setDoctors(list)
      } catch (err) {
        toast.error(err.message || 'Could not load doctors.')
      } finally {
        if (alive) setLoading(false)
      }
    }, 300)
    return () => { alive = false; clearTimeout(id) }
  }, [term])

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: 'white', borderRadius: 'var(--radius-lg)', padding: 0,
        zIndex: 1001, width: '94%', maxWidth: 460, maxHeight: '80vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.2)'
      }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--gray-200)' }}>
          <div className="d-flex align-items-center justify-content-between mb-2">
            <h5 style={{ margin: 0, fontWeight: 700 }}>New Message</h5>
            <button className="btn-ghost" style={{ padding: '4px 10px' }} onClick={onClose} aria-label="Close">
              <i className="bi bi-x-lg" />
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <i className="bi bi-search" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
            <input
              type="text"
              className="form-input-custom"
              style={{ paddingLeft: 34 }}
              placeholder="Search doctors by name or specialization..."
              value={term}
              onChange={e => setTerm(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading ? (
            <div className="text-center py-4"><div className="spinner-custom" /></div>
          ) : doctors.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--gray-400)', padding: 18 }}>No doctors found.</p>
          ) : (
            doctors.map(d => (
              <button
                key={d.id}
                onClick={() => onPick(d.id)}
                className="w-100 text-start"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px',
                  border: 'none', borderBottom: '1px solid var(--gray-100)',
                  background: 'white', cursor: 'pointer',
                }}
              >
                <div className="avatar" style={{ width: 38, height: 38, fontSize: 14 }}>
                  {(d.profiles?.name || 'D').charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }} className="truncate">
                    Dr. {d.profiles?.name || 'Doctor'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gray-400)' }} className="truncate">
                    {d.specialization || ''}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}
