import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { toast } from 'react-toastify'
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUS,
  TARGET_LABELS,
  getAllComplaints,
  getComplaintStats,
  updateComplaintStatus,
} from '../../services/complaints'
import {
  getContactMessages,
  updateContactMessageStatus,
  getContactStats,
} from '../../services/support'
import { deactivateDoctor } from '../../services/admin'
import { setHospitalActive } from '../../services/hospital'
import { SkeletonTable } from '../../components/SkeletonLoader'
import '../../pages/collaborate/CollaborateApplication.css'

const STATUS_TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'UNDER_REVIEW', label: 'Under Review' },
  { key: 'ACTION_TAKEN', label: 'Action Taken' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'REJECTED', label: 'Rejected' },
]

const CATEGORY_LABELS = Object.fromEntries(COMPLAINT_CATEGORIES.map(c => [c.value, c.label]))

export default function AdminComplaints() {
  const { user } = useAuth()
  const [tab, setTab] = useState('complaints')

  // Complaints
  const [complaints, setComplaints] = useState([])
  const [stats, setStats] = useState({ total: 0, open: 0, under_review: 0, resolved: 0, rejected: 0, action_taken: 0 })
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState(null)
  const [adminNotes, setAdminNotes] = useState('')
  const [actionText, setActionText] = useState('')
  const [saving, setSaving] = useState(false)

  // Messages
  const [messages, setMessages] = useState([])
  const [msgStats, setMsgStats] = useState({ total: 0, new: 0 })
  const [loadingMsgs, setLoadingMsgs] = useState(false)

  useEffect(() => {
    loadComplaints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  useEffect(() => {
    if (tab === 'messages') loadMessages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function loadComplaints() {
    try {
      setLoading(true)
      const filters = statusFilter !== 'ALL' ? { status: statusFilter } : {}
      const [list, s] = await Promise.all([getAllComplaints(filters), getComplaintStats()])
      setComplaints(list)
      setStats(s)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load complaints')
    } finally {
      setLoading(false)
    }
  }

  async function loadMessages() {
    try {
      setLoadingMsgs(true)
      const [list, s] = await Promise.all([getContactMessages(), getContactStats()])
      setMessages(list)
      setMsgStats(s)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load messages')
    } finally {
      setLoadingMsgs(false)
    }
  }

  function openDetail(c) {
    setSelected(c)
    setAdminNotes(c.admin_notes ?? '')
    setActionText(c.action_taken ?? '')
  }

  function closeDetail() {
    setSelected(null)
    setAdminNotes('')
    setActionText('')
  }

  async function saveStatus(status) {
    if (!selected) return
    try {
      setSaving(true)
      await updateComplaintStatus(selected.id, { status, adminNotes, actionTaken: actionText }, user.id)
      toast.success('Complaint updated')
      closeDetail()
      loadComplaints()
    } catch (err) {
      toast.error(err.message || 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivateTarget() {
    if (!selected) return
    const { target_type, target_doctor_id, target_hospital_id, target_name } = selected
    if (target_type === 'DOCTOR' && target_doctor_id) {
      if (!window.confirm(`Deactivate ${target_name || 'this doctor'}? They will no longer appear or accept bookings.`)) return
      try {
        setSaving(true)
        await deactivateDoctor(target_doctor_id)
        const action = `Doctor deactivated (${target_name || 'doctor #' + target_doctor_id})`
        setActionText(action)
        await updateComplaintStatus(selected.id, { status: 'ACTION_TAKEN', adminNotes, actionTaken: action }, user.id)
        toast.success('Doctor deactivated and complaint marked as action taken')
        closeDetail()
        loadComplaints()
      } catch (err) {
        toast.error(err.message || 'Failed to deactivate doctor')
      } finally {
        setSaving(false)
      }
    } else if (target_type === 'HOSPITAL' && target_hospital_id) {
      if (!window.confirm(`Deactivate ${target_name || 'this hospital'}? It will be hidden from the directory.`)) return
      try {
        setSaving(true)
        await setHospitalActive(target_hospital_id, false)
        const action = `Hospital deactivated (${target_name || 'hospital #' + target_hospital_id})`
        setActionText(action)
        await updateComplaintStatus(selected.id, { status: 'ACTION_TAKEN', adminNotes, actionTaken: action }, user.id)
        toast.success('Hospital deactivated and complaint marked as action taken')
        closeDetail()
        loadComplaints()
      } catch (err) {
        toast.error(err.message || 'Failed to deactivate hospital')
      } finally {
        setSaving(false)
      }
    }
  }

  async function markMessage(id, status) {
    try {
      await updateContactMessageStatus(id, status)
      toast.success('Message updated')
      loadMessages()
    } catch {
      toast.error('Failed to update message')
    }
  }

  function formatDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const canDeactivate = selected &&
    ((selected.target_type === 'DOCTOR' && selected.target_doctor_id) ||
     (selected.target_type === 'HOSPITAL' && selected.target_hospital_id))

  return (
    <div>
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
        <div>
          <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
            <i className="bi bi-megaphone me-2 text-primary" />Complaints & Support
          </h4>
          <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
            Review complaints, take action, and respond to messages
          </p>
        </div>
        <div className="d-flex gap-2">
          <span style={{ padding: '8px 16px', borderRadius: 'var(--radius-full)', fontSize: 13, fontWeight: 700, background: 'rgba(249,199,79,0.12)', color: '#D97706' }}>
            <i className="bi bi-folder2-open me-1" />{stats.open} Open
          </span>
        </div>
      </div>

      {/* Top tabs */}
      <div className="d-flex gap-2 mb-4">
        <button className={`collab-status-tab ${tab === 'complaints' ? 'active' : ''}`} onClick={() => setTab('complaints')}>
          Complaints <span className="tab-count">{stats.total}</span>
        </button>
        <button className={`collab-status-tab ${tab === 'messages' ? 'active' : ''}`} onClick={() => setTab('messages')}>
          Messages <span className="tab-count">{msgStats.new || ''}</span>
        </button>
      </div>

      {tab === 'complaints' ? (
        <>
          {/* Status tabs */}
          <div className="collab-status-tabs">
            {STATUS_TABS.map(t => {
              const count = t.key === 'ALL' ? stats.total
                : t.key === 'OPEN' ? stats.open
                : t.key === 'UNDER_REVIEW' ? stats.under_review
                : t.key === 'ACTION_TAKEN' ? stats.action_taken
                : t.key === 'RESOLVED' ? stats.resolved
                : stats.rejected
              return (
                <button key={t.key} className={`collab-status-tab ${statusFilter === t.key ? 'active' : ''}`} onClick={() => setStatusFilter(t.key)}>
                  {t.label}<span className="tab-count">{count}</span>
                </button>
              )
            })}
          </div>

          {loading ? (
            <SkeletonTable rows={6} cols={5} />
          ) : complaints.length === 0 ? (
            <div className="card-custom">
              <div className="empty-state" style={{ padding: 48 }}>
                <i className="bi bi-inbox" style={{ fontSize: 48, color: 'var(--gray-300)' }} />
                <p style={{ fontWeight: 600, color: 'var(--gray-500)', marginTop: 16 }}>No complaints found</p>
              </div>
            </div>
          ) : (
            <div className="card-custom p-3">
              {complaints.map(c => {
                const st = COMPLAINT_STATUS[c.status] || COMPLAINT_STATUS.OPEN
                return (
                  <div key={c.id} className="collab-app-card" onClick={() => openDetail(c)}>
                    <div className="app-card-header">
                      <div className="app-avatar hospital">
                        <i className="bi bi-megaphone" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--dark)' }}>{c.subject}</span>
                          <span className={st.badge} style={{ fontSize: 11, padding: '2px 10px' }}>
                            <i className={`bi ${st.icon} me-1`} />{st.label}
                          </span>
                        </div>
                        <div className="app-card-meta mt-1">
                          <span><i className="bi bi-person" />{c.complainant_name || 'User'} ({c.complainant_role})</span>
                          <span><i className="bi bi-arrow-right" />{c.target_name || TARGET_LABELS[c.target_type]}</span>
                          <span><i className="bi bi-tag" />{CATEGORY_LABELS[c.category] || c.category}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{formatDate(c.created_at)}</div>
                        <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>#CMP-{String(c.id).padStart(5, '0')}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        // Messages tab
        loadingMsgs ? (
          <SkeletonTable rows={6} cols={4} />
        ) : messages.length === 0 ? (
          <div className="card-custom">
            <div className="empty-state" style={{ padding: 48 }}>
              <i className="bi bi-chat-square" style={{ fontSize: 48, color: 'var(--gray-300)' }} />
              <p style={{ fontWeight: 600, color: 'var(--gray-500)', marginTop: 16 }}>No messages yet</p>
            </div>
          </div>
        ) : (
          <div className="card-custom">
            <div className="table-responsive">
              <table className="table-custom">
                <thead>
                  <tr><th>From</th><th>Type</th><th>Message</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {messages.map(m => (
                    <tr key={m.id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{m.email}</div>
                      </td>
                      <td><span className="badge-confirmed" style={{ fontSize: 11 }}>{m.type}</span></td>
                      <td style={{ maxWidth: 360 }}>
                        {m.subject && <div style={{ fontWeight: 600, fontSize: 13 }}>{m.subject}</div>}
                        <div style={{ fontSize: 13, color: 'var(--gray-600)' }}>{m.message}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>{formatDate(m.created_at)}</div>
                      </td>
                      <td>
                        <span className={m.status === 'NEW' ? 'badge-pending' : 'badge-confirmed'} style={{ fontSize: 11 }}>{m.status}</span>
                      </td>
                      <td>
                        <div className="d-flex gap-1">
                          {m.status === 'NEW' && (
                            <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => markMessage(m.id, 'READ')}>
                              <i className="bi bi-check2" /> Read
                            </button>
                          )}
                          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12, color: 'var(--success)' }} onClick={() => markMessage(m.id, 'RESPONDED')}>
                            Responded
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* ── Complaint detail drawer ── */}
      {selected && (
        <>
          <div className="overlay" onClick={closeDetail} />
          <div className="collab-detail-modal">
            <div className="modal-header">
              <div>
                <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0, fontSize: 18 }}>{selected.subject}</h5>
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>#CMP-{String(selected.id).padStart(5, '0')}</span>
              </div>
              <button className="btn-ghost" onClick={closeDetail} style={{ padding: 8 }}>
                <i className="bi bi-x-lg" style={{ fontSize: 18 }} />
              </button>
            </div>

            <div className="modal-body">
              <div className="d-flex align-items-center gap-2 mb-4 flex-wrap">
                <span className={(COMPLAINT_STATUS[selected.status] || COMPLAINT_STATUS.OPEN).badge} style={{ fontSize: 13, padding: '6px 16px' }}>
                  <i className={`bi ${(COMPLAINT_STATUS[selected.status] || COMPLAINT_STATUS.OPEN).icon} me-1`} />
                  {(COMPLAINT_STATUS[selected.status] || COMPLAINT_STATUS.OPEN).label}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 'var(--radius-full)', background: 'rgba(0,119,182,0.08)', color: 'var(--primary)' }}>
                  {CATEGORY_LABELS[selected.category] || selected.category}
                </span>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Parties</div>
                <div className="detail-row"><span className="detail-label">Filed by</span><span className="detail-value">{selected.complainant_name || '—'} ({selected.complainant_role})</span></div>
                <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{selected.complainant_email || '—'}</span></div>
                <div className="detail-row"><span className="detail-label">Against</span><span className="detail-value">{selected.target_name || TARGET_LABELS[selected.target_type]}</span></div>
                <div className="detail-row"><span className="detail-label">Filed on</span><span className="detail-value">{formatDate(selected.created_at)}</span></div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Description</div>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--gray-600)', margin: 0 }}>{selected.description}</p>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Admin Response (visible to complainant)</div>
                <textarea
                  className="form-input-custom"
                  rows={3}
                  value={adminNotes}
                  onChange={e => setAdminNotes(e.target.value)}
                  maxLength={1000}
                  placeholder="Add a note / response..."
                />
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Action Taken</div>
                <input
                  type="text"
                  className="form-input-custom"
                  value={actionText}
                  onChange={e => setActionText(e.target.value)}
                  maxLength={300}
                  placeholder="e.g. Warning issued, account deactivated..."
                />
                {canDeactivate && (
                  <button
                    className="btn-outline-custom mt-3"
                    style={{ color: 'var(--danger)', borderColor: 'rgba(239,35,60,0.3)', fontSize: 13 }}
                    onClick={handleDeactivateTarget}
                    disabled={saving}
                  >
                    <i className="bi bi-slash-circle me-1" />
                    Deactivate {selected.target_type === 'DOCTOR' ? 'Doctor' : 'Hospital'}
                  </button>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-ghost flex-fill justify-content-center" style={{ fontSize: 13 }} onClick={() => saveStatus('UNDER_REVIEW')} disabled={saving}>
                <i className="bi bi-eye me-1" />Under Review
              </button>
              <button className="btn-ghost flex-fill justify-content-center" style={{ fontSize: 13, color: 'var(--danger)' }} onClick={() => saveStatus('REJECTED')} disabled={saving}>
                <i className="bi bi-x-circle me-1" />Reject
              </button>
              <button className="btn-primary-custom flex-fill justify-content-center" style={{ fontSize: 13 }} onClick={() => saveStatus('RESOLVED')} disabled={saving}>
                <i className="bi bi-check-circle me-1" />Resolve
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
