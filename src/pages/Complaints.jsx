import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { toast } from 'react-toastify'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUS,
  ALLOWED_TARGETS,
  TARGET_LABELS,
  getComplaintTargets,
  createComplaint,
  getMyComplaints,
} from '../services/complaints'

const EMPTY_FORM = { target_type: '', target: null, category: 'OTHER', subject: '', description: '' }

export default function Complaints() {
  const { profile } = useAuth()
  const role = profile?.role

  const [form, setForm] = useState(EMPTY_FORM)
  const [targets, setTargets] = useState([])
  const [loadingTargets, setLoadingTargets] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  const allowedTargets = ALLOWED_TARGETS[role] ?? []

  useEffect(() => {
    loadMine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function loadMine() {
    if (!profile?.id) return
    try {
      setLoading(true)
      const data = await getMyComplaints(profile.id)
      setComplaints(data)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load your complaints')
    } finally {
      setLoading(false)
    }
  }

  async function handleTargetTypeChange(targetType) {
    setForm(prev => ({ ...prev, target_type: targetType, target: null }))
    setTargets([])
    if (!targetType || targetType === 'MANAGEMENT') return
    try {
      setLoadingTargets(true)
      const opts = await getComplaintTargets(targetType, role, profile.id)
      setTargets(opts)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load options')
    } finally {
      setLoadingTargets(false)
    }
  }

  function selectTarget(id) {
    const found = targets.find(t => t.id === id) || null
    setForm(prev => ({ ...prev, target: found }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      setSubmitting(true)
      await createComplaint(form, profile)
      toast.success('Complaint submitted. Our team will review it shortly.')
      setForm(EMPTY_FORM)
      setTargets([])
      loadMine()
    } catch (err) {
      toast.error(err.message || 'Failed to submit complaint')
    } finally {
      setSubmitting(false)
    }
  }

  function formatDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <Navbar />

      <div className="page-header">
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <div className="section-badge">Support</div>
          <h1 style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', color: 'white', fontFamily: 'var(--font-display)', margin: 0 }}>
            Complaints & Petitions
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.75)', marginTop: 8, fontSize: 16, marginBottom: 0 }}>
            Raise a concern and track its status. All complaints are reviewed by our team.
          </p>
        </div>
      </div>

      <div className="container py-5">
        <div className="row g-4">
          {/* Raise form */}
          <div className="col-lg-5">
            <div className="card-custom p-4 position-sticky" style={{ top: 90 }}>
              <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 4 }}>
                <i className="bi bi-megaphone me-2 text-primary" />Raise a Complaint
              </h5>
              <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 20 }}>
                Filing as <strong>{role?.charAt(0) + role?.slice(1).toLowerCase()}</strong>
              </p>

              <form onSubmit={handleSubmit} noValidate>
                {/* Target type */}
                <div className="mb-3">
                  <label className="form-label-custom">Complaint Against *</label>
                  <select
                    className="form-input-custom"
                    value={form.target_type}
                    onChange={e => handleTargetTypeChange(e.target.value)}
                    required
                  >
                    <option value="">Select...</option>
                    {allowedTargets.map(t => (
                      <option key={t} value={t}>{TARGET_LABELS[t]}</option>
                    ))}
                  </select>
                </div>

                {/* Target entity */}
                {form.target_type && form.target_type !== 'MANAGEMENT' && (
                  <div className="mb-3">
                    <label className="form-label-custom">Select {TARGET_LABELS[form.target_type]} *</label>
                    <select
                      className="form-input-custom"
                      value={form.target?.id ?? ''}
                      onChange={e => selectTarget(e.target.value)}
                      disabled={loadingTargets}
                      required
                    >
                      <option value="">{loadingTargets ? 'Loading...' : 'Select...'}</option>
                      {targets.map(t => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                    {!loadingTargets && targets.length === 0 && (
                      <span className="form-error"><i className="bi bi-info-circle" />No related records found to file against.</span>
                    )}
                  </div>
                )}

                {/* Category */}
                <div className="mb-3">
                  <label className="form-label-custom">Category *</label>
                  <select
                    className="form-input-custom"
                    value={form.category}
                    onChange={e => setForm({ ...form, category: e.target.value })}
                    required
                  >
                    {COMPLAINT_CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>

                {/* Subject */}
                <div className="mb-3">
                  <label className="form-label-custom">Subject *</label>
                  <input
                    type="text"
                    className="form-input-custom"
                    value={form.subject}
                    onChange={e => setForm({ ...form, subject: e.target.value })}
                    maxLength={150}
                    placeholder="Brief title of your complaint"
                    required
                  />
                </div>

                {/* Description */}
                <div className="mb-3">
                  <label className="form-label-custom">Description *</label>
                  <textarea
                    className="form-input-custom"
                    rows={5}
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    maxLength={3000}
                    placeholder="Describe what happened, with dates and details..."
                    required
                  />
                  <div className={`char-counter ${form.description.length > 2700 ? 'warning' : ''}`}>
                    {form.description.length}/3000
                  </div>
                </div>

                <button type="submit" className="btn-primary-custom w-100 justify-content-center" disabled={submitting}>
                  {submitting ? (
                    <><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> Submitting...</>
                  ) : (
                    <><i className="bi bi-send me-1" />Submit Complaint</>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Track list */}
          <div className="col-lg-7">
            <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
              <i className="bi bi-list-check me-2 text-primary" />My Complaints
              <span style={{ color: 'var(--gray-400)', fontWeight: 500, fontSize: 14 }}> ({complaints.length})</span>
            </h5>

            {loading ? (
              <div className="card-custom p-4"><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text short" /></div>
            ) : complaints.length === 0 ? (
              <div className="card-custom">
                <div className="empty-state" style={{ padding: 40 }}>
                  <i className="bi bi-inbox" style={{ fontSize: 44, color: 'var(--gray-300)' }} />
                  <p style={{ fontWeight: 600, color: 'var(--gray-500)', marginTop: 12 }}>No complaints yet</p>
                  <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Complaints you file will appear here for tracking.</p>
                </div>
              </div>
            ) : (
              <div className="d-flex flex-column gap-3">
                {complaints.map(c => {
                  const st = COMPLAINT_STATUS[c.status] || COMPLAINT_STATUS.OPEN
                  const isOpen = expanded === c.id
                  return (
                    <div key={c.id} className="card-custom p-3">
                      <div className="d-flex justify-content-between align-items-start gap-2" style={{ cursor: 'pointer' }}
                        onClick={() => setExpanded(isOpen ? null : c.id)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--dark)' }}>{c.subject}</span>
                            <span className={st.badge} style={{ fontSize: 11, padding: '2px 10px' }}>
                              <i className={`bi ${st.icon} me-1`} />{st.label}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 4 }}>
                            Against: {c.target_name || TARGET_LABELS[c.target_type]} · {formatDate(c.created_at)}
                          </div>
                        </div>
                        <i className={`bi ${isOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ color: 'var(--gray-400)' }} />
                      </div>

                      {isOpen && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--gray-100)' }}>
                          <p style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.7, margin: '0 0 10px' }}>
                            {c.description}
                          </p>
                          <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                            Reference #CMP-{String(c.id).padStart(5, '0')}
                          </div>
                          {c.admin_notes && (
                            <div className="alert-custom alert-info mt-3" style={{ fontSize: 13 }}>
                              <i className="bi bi-chat-left-text" />
                              <span><strong>Admin response:</strong> {c.admin_notes}</span>
                            </div>
                          )}
                          {c.action_taken && (
                            <div className="alert-custom alert-success mt-2" style={{ fontSize: 13 }}>
                              <i className="bi bi-shield-check" />
                              <span><strong>Action taken:</strong> {c.action_taken}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
