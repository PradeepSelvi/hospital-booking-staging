 import { useState, useEffect, useMemo } from 'react'
import { toast } from 'react-toastify'
import {
  getAllPayments, getPaymentStats, adminFailPayment, adminRefundPayment, paiseToRupees,
} from '../../services/payments'
import { SkeletonTable } from '../../components/SkeletonLoader'
import Modal from '../../components/Modal'
import '../../pages/collaborate/CollaborateApplication.css'

const STATUS_TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'PAID', label: 'Paid' },
  { key: 'REFUNDED', label: 'Refunded' },
  { key: 'FAILED', label: 'Failed' },
]

const STATUS_BADGE = {
  PENDING: { label: 'Pending', className: 'badge-pending' },
  PAID: { label: 'Paid', className: 'badge-confirmed' },
  REFUNDED: { label: 'Refunded', className: 'badge-cancelled' },
  FAILED: { label: 'Failed', className: 'badge-cancelled' },
}

function money(paise) {
  return `₹${Number(paiseToRupees(paise)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}

export default function AdminPayments() {
  const [payments, setPayments] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')

  // Action modal state
  const [action, setAction] = useState(null) // { type: 'REFUND'|'FAIL', payment }
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  async function loadData() {
    try {
      setLoading(true)
      const filters = {}
      if (statusFilter !== 'ALL') filters.status = statusFilter
      const [list, s] = await Promise.all([
        getAllPayments(filters),
        getPaymentStats().catch(() => null),
      ])
      setPayments(list)
      if (s) setStats(s)
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Failed to load payments')
    } finally {
      setLoading(false)
    }
  }

  // Client-side text search across patient/doctor/receipt (avoids filter injection).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return payments
    return payments.filter(p => {
      const patient = p.patient?.name?.toLowerCase() ?? ''
      const email = p.patient?.email?.toLowerCase() ?? ''
      const doctor = p.doctor?.profiles?.name?.toLowerCase() ?? ''
      const receipt = p.receipt_number?.toLowerCase() ?? ''
      const order = p.razorpay_order_id?.toLowerCase() ?? ''
      return patient.includes(q) || email.includes(q) || doctor.includes(q) ||
        receipt.includes(q) || order.includes(q)
    })
  }, [payments, search])

  function openAction(type, payment) {
    setAction({ type, payment })
    setReason('')
  }

  async function submitAction() {
    if (!action) return
    if (!reason.trim()) {
      toast.error('Please enter a reason.')
      return
    }
    try {
      setSubmitting(true)
      if (action.type === 'REFUND') {
        await adminRefundPayment(action.payment.id, reason.trim())
        toast.success('Refund recorded.')
      } else {
        await adminFailPayment(action.payment.id, reason.trim())
        toast.success('Payment marked as failed.')
      }
      setAction(null)
      setReason('')
      loadData()
    } catch (err) {
      toast.error(err.message || 'Action failed')
    } finally {
      setSubmitting(false)
    }
  }

  function formatDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) return (
    <div>
      <div className="skeleton skeleton-heading" style={{ marginBottom: 'var(--space-4)' }} />
      <SkeletonTable rows={6} cols={6} />
    </div>
  )

  const kpis = stats ? [
    { label: 'Collected', value: money(stats.collected_paise), sub: `${stats.paid_count} paid`, color: 'var(--success)', bg: 'rgba(45,198,83,0.1)', icon: 'bi-cash-stack' },
    { label: 'Pending', value: money(stats.pending_paise), sub: `${stats.pending_count} awaiting`, color: 'var(--warning)', bg: 'rgba(249,199,79,0.12)', icon: 'bi-hourglass-split' },
    { label: 'Refunded', value: money(stats.refunded_paise), sub: `${stats.refunded_count} refunds`, color: 'var(--danger)', bg: 'rgba(239,35,60,0.1)', icon: 'bi-arrow-return-left' },
    { label: 'Online / Offline', value: `${stats.online_count} / ${stats.offline_count}`, sub: 'paid split', color: 'var(--primary)', bg: 'rgba(0,119,182,0.1)', icon: 'bi-credit-card' },
  ] : []

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
          <i className="bi bi-wallet2 me-2 text-primary" />Payments
        </h4>
        <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
          Track consultation payments and manage refunds. Payments can only be settled through the gateway — this panel records reconciliation actions.
        </p>
      </div>

      {/* KPIs */}
      {stats && (
        <div className="row g-3 mb-4 stagger-children">
          {kpis.map((k, i) => (
            <div key={i} className="col-6 col-xl-3">
              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: k.bg, color: k.color }}>
                  <i className={`bi ${k.icon}`} />
                </div>
                <div className="kpi-value" style={{ fontSize: 22 }}>{k.value}</div>
                <div className="kpi-label">{k.label}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>{k.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Status tabs */}
      <div className="collab-status-tabs">
        {STATUS_TABS.map(t => (
          <button key={t.key} className={`collab-status-tab ${statusFilter === t.key ? 'active' : ''}`} onClick={() => setStatusFilter(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="card-custom p-3 mb-4">
        <div className="search-input-wrapper" style={{ maxWidth: 380 }}>
          <i className="bi bi-search" />
          <input
            type="text"
            className="form-input-custom"
            placeholder="Search patient, doctor, or receipt no..."
            style={{ paddingLeft: 42 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
            maxLength={100}
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="card-custom">
          <div className="empty-state" style={{ padding: 48 }}>
            <i className="bi bi-receipt" style={{ fontSize: 48, color: 'var(--gray-300)' }} />
            <p style={{ fontWeight: 600, color: 'var(--gray-500)', marginTop: 16 }}>No payments found</p>
            <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Try a different filter or search.</p>
          </div>
        </div>
      ) : (
        <div className="card-custom">
          <div className="table-responsive">
            <table className="table-custom">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Receipt</th>
                  <th>Requested</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const sb = STATUS_BADGE[p.status] || STATUS_BADGE.PENDING
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{p.patient?.name || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{p.patient?.email || ''}</div>
                      </td>
                      <td style={{ fontSize: 13 }}>
                        Dr. {p.doctor?.profiles?.name || '—'}
                        <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{p.doctor?.specialization || ''}</div>
                      </td>
                      <td style={{ fontWeight: 700 }}>{money(p.amount_paise)}</td>
                      <td style={{ fontSize: 13 }}>{p.method || '—'}</td>
                      <td>
                        <span className={sb.className}>{sb.label}</span>
                        {p.admin_note && (
                          <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2, maxWidth: 180 }} title={p.admin_note}>
                            "{p.admin_note}"
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{p.receipt_number || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{formatDate(p.requested_at)}</td>
                      <td>
                        {p.status === 'PAID' && (
                          <button
                            className="btn-ghost"
                            style={{ padding: '4px 12px', fontSize: 12, color: 'var(--danger)' }}
                            onClick={() => openAction('REFUND', p)}
                          >
                            <i className="bi bi-arrow-return-left me-1" />Refund
                          </button>
                        )}
                        {p.status === 'PENDING' && (
                          <button
                            className="btn-ghost"
                            style={{ padding: '4px 12px', fontSize: 12, color: 'var(--gray-600)' }}
                            onClick={() => openAction('FAIL', p)}
                          >
                            <i className="bi bi-x-circle me-1" />Mark Failed
                          </button>
                        )}
                        {(p.status === 'FAILED' || p.status === 'REFUNDED') && (
                          <span style={{ fontSize: 12, color: 'var(--gray-300)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action modal */}
      {action && (
        <Modal
          isOpen={!!action}
          onClose={() => !submitting && setAction(null)}
          title={action.type === 'REFUND' ? 'Record Refund' : 'Mark Payment Failed'}
        >
          <div style={{ padding: '4px 4px 8px' }}>
            <p style={{ fontSize: 14, color: 'var(--gray-600)' }}>
              {action.type === 'REFUND' ? (
                <>You are recording a refund of <strong>{money(action.payment.amount_paise)}</strong> for{' '}
                <strong>{action.payment.patient?.name}</strong>. Process the actual refund in the Razorpay dashboard first — this records it for reconciliation.</>
              ) : (
                <>Mark the pending payment of <strong>{money(action.payment.amount_paise)}</strong> for{' '}
                <strong>{action.payment.patient?.name}</strong> as failed. This does not complete the appointment.</>
              )}
            </p>
            <label className="form-label-custom required" style={{ marginTop: 8 }}>Reason</label>
            <textarea
              className="form-input-custom"
              rows={3}
              maxLength={500}
              placeholder={action.type === 'REFUND' ? 'e.g. Appointment cancelled by clinic, refund issued via Razorpay ref #...' : 'e.g. Payment abandoned by patient'}
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={submitting}
            />
            <div className="d-flex justify-content-end gap-2 mt-3">
              <button className="btn-outline-custom" onClick={() => setAction(null)} disabled={submitting}>
                Cancel
              </button>
              <button
                className="btn-primary-custom"
                onClick={submitAction}
                disabled={submitting || !reason.trim()}
                style={action.type === 'REFUND' ? { background: 'var(--danger)' } : undefined}
              >
                {submitting ? (
                  <><div className="spinner-custom" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving...</>
                ) : (
                  action.type === 'REFUND' ? 'Record Refund' : 'Mark Failed'
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
