import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import {
  getAllHospitalsAdmin,
  getHospitalAdminStats,
  setHospitalActive,
  setHospitalVerified,
  updateHospitalProfile,
  getHospitalDoctorsAdmin,
  getPhotoUrl,
  getSummaryDocUrl,
  validateWebsiteUrl,
} from '../../services/hospital'
import { SkeletonTable } from '../../components/SkeletonLoader'
import '../../pages/collaborate/CollaborateApplication.css'

const TYPE_LABELS = {
  GOVERNMENT: 'Government',
  PRIVATE: 'Private',
  CLINIC: 'Clinic',
  MULTI_SPECIALTY: 'Multi-Specialty',
}

const STATUS_TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'INACTIVE', label: 'Inactive' },
  { key: 'UNVERIFIED', label: 'Unverified' },
]

const EMPTY_FORM = {
  name: '', type: '', registration_number: '', bed_count: '',
  address: '', city: '', state: '', pincode: '',
  phone: '', email: '', website: '',
}

export default function ManageHospitals() {
  const [hospitals, setHospitals] = useState([])
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0, verified: 0, unverified: 0 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  // Detail drawer
  const [selected, setSelected] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [detailDoctors, setDetailDoctors] = useState([])
  const [loadingDoctors, setLoadingDoctors] = useState(false)

  // Edit modal
  const [showEdit, setShowEdit] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter])

  async function loadData() {
    try {
      setLoading(true)
      const filters = {}
      if (statusFilter !== 'ALL') filters.status = statusFilter
      if (typeFilter) filters.type = typeFilter
      if (search.trim()) filters.search = search.trim()

      const [list, s] = await Promise.all([
        getAllHospitalsAdmin(filters),
        getHospitalAdminStats(),
      ])
      setHospitals(list)
      setStats(s)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load hospitals')
    } finally {
      setLoading(false)
    }
  }

  function handleSearch(e) {
    e?.preventDefault()
    loadData()
  }

  async function openDetail(hospital) {
    setSelected(hospital)
    setShowDetail(true)
    try {
      setLoadingDoctors(true)
      const docs = await getHospitalDoctorsAdmin(hospital.id)
      setDetailDoctors(docs)
    } catch {
      setDetailDoctors([])
    } finally {
      setLoadingDoctors(false)
    }
  }

  function closeDetail() {
    setShowDetail(false)
    setSelected(null)
    setDetailDoctors([])
  }

  async function handleToggleActive(hospital, e) {
    e?.stopPropagation()
    try {
      await setHospitalActive(hospital.id, !hospital.is_active)
      toast.success(hospital.is_active ? 'Hospital deactivated' : 'Hospital activated')
      if (selected?.id === hospital.id) setSelected({ ...selected, is_active: !hospital.is_active })
      loadData()
    } catch {
      toast.error('Failed to update status')
    }
  }

  async function handleToggleVerified(hospital, e) {
    e?.stopPropagation()
    try {
      await setHospitalVerified(hospital.id, !hospital.is_verified)
      toast.success(hospital.is_verified ? 'Verification removed' : 'Hospital verified')
      if (selected?.id === hospital.id) setSelected({ ...selected, is_verified: !hospital.is_verified })
      loadData()
    } catch {
      toast.error('Failed to update verification')
    }
  }

  function openEdit(hospital, e) {
    e?.stopPropagation()
    setSelected(hospital)
    setForm({
      name: hospital.name ?? '',
      type: hospital.type ?? '',
      registration_number: hospital.registration_number ?? '',
      bed_count: hospital.bed_count ?? '',
      address: hospital.address ?? '',
      city: hospital.city ?? '',
      state: hospital.state ?? '',
      pincode: hospital.pincode ?? '',
      phone: hospital.phone ?? '',
      email: hospital.email ?? '',
      website: hospital.website ?? '',
    })
    setFormErrors({})
    setShowEdit(true)
  }

  function validateForm() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Hospital name is required'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Enter a valid email'
    if (form.bed_count !== '' && (isNaN(form.bed_count) || Number(form.bed_count) < 0)) {
      errs.bed_count = 'Bed count must be a positive number'
    }
    const urlCheck = validateWebsiteUrl(form.website)
    if (!urlCheck.valid) errs.website = urlCheck.error
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  function clearError(field) {
    setFormErrors(prev => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!validateForm()) return
    try {
      setSaving(true)
      const updated = await updateHospitalProfile(selected.id, form)
      toast.success('Hospital updated')
      setShowEdit(false)
      setSelected(prev => (prev ? { ...prev, ...updated } : prev))
      loadData()
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Failed to update hospital')
    } finally {
      setSaving(false)
    }
  }

  async function openSummaryDoc() {
    if (!selected?.summary_doc_url) return
    const url = await getSummaryDocUrl(selected.summary_doc_url)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else toast.error('Could not open document')
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  }

  if (loading) return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <div className="skeleton skeleton-heading" style={{ marginBottom: 'var(--space-2)' }} />
          <div className="skeleton skeleton-text short" />
        </div>
      </div>
      <div className="d-flex gap-2 mb-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="skeleton" style={{ width: 100, height: 38, borderRadius: 'var(--radius-full)' }} />
        ))}
      </div>
      <SkeletonTable rows={6} cols={6} />
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
        <div>
          <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
            <i className="bi bi-hospital me-2 text-primary" />Manage Hospitals
          </h4>
          <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
            View and manage hospital accounts, details, and verification
          </p>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div style={{
            padding: '8px 16px', borderRadius: 'var(--radius-full)', fontSize: 13,
            fontWeight: 700, background: 'rgba(0,119,182,0.10)', color: 'var(--primary)'
          }}>
            <i className="bi bi-buildings me-1" />{stats.total} Total
          </div>
          <div style={{
            padding: '8px 16px', borderRadius: 'var(--radius-full)', fontSize: 13,
            fontWeight: 700, background: 'rgba(45,198,83,0.12)', color: '#2DC653'
          }}>
            <i className="bi bi-patch-check me-1" />{stats.verified} Verified
          </div>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="collab-status-tabs">
        {STATUS_TABS.map(tab => {
          const count = tab.key === 'ALL' ? stats.total
            : tab.key === 'ACTIVE' ? stats.active
            : tab.key === 'INACTIVE' ? stats.inactive
            : stats.unverified
          return (
            <button
              key={tab.key}
              className={`collab-status-tab ${statusFilter === tab.key ? 'active' : ''}`}
              onClick={() => setStatusFilter(tab.key)}
            >
              {tab.label}
              <span className="tab-count">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Search + Filter Bar */}
      <div className="card-custom p-3 mb-4">
        <div className="d-flex gap-3 flex-wrap">
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: 220 }}>
            <i className="bi bi-search" />
            <form onSubmit={handleSearch}>
              <input
                type="text"
                className="form-input-custom"
                placeholder="Search by name, city, or registration no..."
                style={{ paddingLeft: 42 }}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onBlur={handleSearch}
                maxLength={100}
              />
            </form>
          </div>
          <select
            className="form-input-custom"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{ width: 180 }}
          >
            <option value="">All Types</option>
            {Object.entries(TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {hospitals.length === 0 ? (
        <div className="card-custom">
          <div className="empty-state" style={{ padding: 48 }}>
            <i className="bi bi-hospital" style={{ fontSize: 48, color: 'var(--gray-300)' }} />
            <p style={{ fontWeight: 600, color: 'var(--gray-500)', marginTop: 16 }}>No hospitals found</p>
            <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>
              {statusFilter !== 'ALL' || typeFilter ? 'Try changing the filters' : 'Hospital accounts will appear here'}
            </p>
          </div>
        </div>
      ) : (
        <div className="card-custom">
          <div className="table-responsive">
            <table className="table-custom">
              <thead>
                <tr>
                  <th>Hospital</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th>Doctors</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {hospitals.map(h => (
                  <tr key={h.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(h)}>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="avatar" style={{ width: 36, height: 36, fontSize: 13, background: 'rgba(0,119,182,0.12)', color: 'var(--primary)' }}>
                          {h.cover_photo_url
                            ? <img src={getPhotoUrl(h.cover_photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                            : <i className="bi bi-hospital" />}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {h.name}
                            {h.is_verified && <i className="bi bi-patch-check-fill" style={{ color: '#2DC653', fontSize: 13 }} title="Verified" />}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{h.owner?.email ?? '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td>{TYPE_LABELS[h.type] ?? '—'}</td>
                    <td>{h.city ? `${h.city}${h.state ? ', ' + h.state : ''}` : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{h.doctorCount}</td>
                    <td>
                      <span className={h.is_active ? 'badge-confirmed' : 'badge-cancelled'}>
                        {h.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="d-flex gap-1">
                        <button
                          className="btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 12, color: 'var(--primary)' }}
                          onClick={(e) => openEdit(h, e)}
                          title="Edit details"
                        >
                          <i className="bi bi-pencil" />
                        </button>
                        <button
                          className="btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 12, color: h.is_verified ? 'var(--gray-400)' : '#2DC653' }}
                          onClick={(e) => handleToggleVerified(h, e)}
                          title={h.is_verified ? 'Remove verification' : 'Verify hospital'}
                        >
                          <i className={`bi ${h.is_verified ? 'bi-patch-minus' : 'bi-patch-check'}`} />
                        </button>
                        <button
                          className="btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 12, color: h.is_active ? 'var(--danger)' : 'var(--success)' }}
                          onClick={(e) => handleToggleActive(h, e)}
                          title={h.is_active ? 'Deactivate' : 'Activate'}
                        >
                          <i className={`bi ${h.is_active ? 'bi-x-circle' : 'bi-check-circle'}`} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Detail Drawer ── */}
      {showDetail && selected && (
        <>
          <div className="overlay" onClick={closeDetail} />
          <div className="collab-detail-modal">
            <div className="modal-header">
              <div>
                <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0, fontSize: 18 }}>
                  {selected.name}
                </h5>
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                  Hospital #{selected.id} · Joined {formatDate(selected.created_at)}
                </span>
              </div>
              <button className="btn-ghost" onClick={closeDetail} style={{ padding: 8 }}>
                <i className="bi bi-x-lg" style={{ fontSize: 18 }} />
              </button>
            </div>

            <div className="modal-body">
              {/* Status badges */}
              <div className="d-flex align-items-center gap-2 mb-4 flex-wrap">
                <span className={selected.is_active ? 'badge-confirmed' : 'badge-cancelled'} style={{ fontSize: 13, padding: '6px 16px' }}>
                  <i className={`bi ${selected.is_active ? 'bi-check-circle' : 'bi-x-circle'} me-1`} />
                  {selected.is_active ? 'Active' : 'Inactive'}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 'var(--radius-full)',
                  background: selected.is_verified ? 'rgba(45,198,83,0.10)' : 'rgba(245,158,11,0.10)',
                  color: selected.is_verified ? '#2DC653' : '#D97706'
                }}>
                  <i className={`bi ${selected.is_verified ? 'bi-patch-check' : 'bi-patch-exclamation'} me-1`} />
                  {selected.is_verified ? 'Verified' : 'Unverified'}
                </span>
                {selected.type && (
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 'var(--radius-full)',
                    background: 'rgba(0,119,182,0.08)', color: 'var(--primary)'
                  }}>
                    {TYPE_LABELS[selected.type]}
                  </span>
                )}
              </div>

              {/* Cover photo */}
              {selected.cover_photo_url && (
                <img
                  src={getPhotoUrl(selected.cover_photo_url)}
                  alt="Cover"
                  style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 'var(--radius-md, 10px)', marginBottom: 16 }}
                />
              )}

              {/* Owner */}
              <div className="detail-section">
                <div className="detail-section-title">Owner Account</div>
                <div className="detail-row">
                  <span className="detail-label">Name</span>
                  <span className="detail-value">{selected.owner?.name ?? '—'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Email</span>
                  <span className="detail-value">{selected.owner?.email ?? '—'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Phone</span>
                  <span className="detail-value">{selected.owner?.phone ?? '—'}</span>
                </div>
              </div>

              {/* Hospital details */}
              <div className="detail-section">
                <div className="detail-section-title">Hospital Information</div>
                {selected.registration_number && (
                  <div className="detail-row">
                    <span className="detail-label">Registration No.</span>
                    <span className="detail-value" style={{ fontFamily: 'monospace' }}>{selected.registration_number}</span>
                  </div>
                )}
                {selected.bed_count != null && (
                  <div className="detail-row">
                    <span className="detail-label">Bed Count</span>
                    <span className="detail-value">{selected.bed_count}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">Phone</span>
                  <span className="detail-value">{selected.phone ?? '—'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Email</span>
                  <span className="detail-value">{selected.email ?? '—'}</span>
                </div>
                {selected.website && (
                  <div className="detail-row">
                    <span className="detail-label">Website</span>
                    <span className="detail-value">
                      <a href={selected.website.startsWith('http') ? selected.website : `https://${selected.website}`}
                         target="_blank" rel="noopener noreferrer">{selected.website}</a>
                    </span>
                  </div>
                )}
              </div>

              {/* Location */}
              <div className="detail-section">
                <div className="detail-section-title">Location</div>
                <div className="detail-row">
                  <span className="detail-label">Address</span>
                  <span className="detail-value">
                    {selected.address || '—'}
                    {selected.city ? `, ${selected.city}` : ''}
                    {selected.state ? `, ${selected.state}` : ''}
                    {selected.pincode ? ` - ${selected.pincode}` : ''}
                  </span>
                </div>
              </div>

              {/* Summary */}
              {(selected.summary_text || selected.summary_doc_url) && (
                <div className="detail-section">
                  <div className="detail-section-title">Summary</div>
                  {selected.summary_text && (
                    <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--gray-600)', margin: '0 0 12px' }}>
                      {selected.summary_text}
                    </p>
                  )}
                  {selected.summary_doc_url && (
                    <button className="btn-outline-custom" style={{ fontSize: 12, padding: '6px 14px' }} onClick={openSummaryDoc}>
                      <i className="bi bi-file-earmark-medical me-1" />View Brochure
                    </button>
                  )}
                </div>
              )}

              {/* Affiliated doctors */}
              <div className="detail-section">
                <div className="detail-section-title">Affiliated Doctors ({detailDoctors.length})</div>
                {loadingDoctors ? (
                  <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>Loading…</div>
                ) : detailDoctors.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>No doctors affiliated yet</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {detailDoctors.map(aff => (
                      <div key={aff.id} className="d-flex align-items-center gap-2 p-2"
                           style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md, 10px)' }}>
                        <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                          {aff.doctors?.profiles?.name?.charAt(0) ?? 'D'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>Dr. {aff.doctors?.profiles?.name ?? '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                            {aff.doctors?.specialization ?? '—'}
                            {aff.is_primary ? ' · Primary' : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="btn-ghost flex-fill justify-content-center"
                style={{ fontSize: 13, color: selected.is_active ? 'var(--danger)' : 'var(--success)' }}
                onClick={() => handleToggleActive(selected)}
              >
                <i className={`bi ${selected.is_active ? 'bi-x-circle' : 'bi-check-circle'} me-1`} />
                {selected.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button
                className="btn-outline-custom flex-fill justify-content-center"
                style={{ fontSize: 13 }}
                onClick={() => handleToggleVerified(selected)}
              >
                <i className={`bi ${selected.is_verified ? 'bi-patch-minus' : 'bi-patch-check'} me-1`} />
                {selected.is_verified ? 'Unverify' : 'Verify'}
              </button>
              <button
                className="btn-primary-custom flex-fill justify-content-center"
                style={{ fontSize: 13 }}
                onClick={() => openEdit(selected)}
              >
                <i className="bi bi-pencil me-1" />Edit Details
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Edit Modal ── */}
      {showEdit && selected && (
        <>
          <div className="overlay" onClick={() => setShowEdit(false)} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'white', borderRadius: 'var(--radius-lg)', padding: 32,
            zIndex: 1001, width: '90%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 24px 80px rgba(0,0,0,0.2)'
          }}>
            <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
              <i className="bi bi-pencil-square me-2 text-primary" />Edit Hospital Details
            </h5>
            <form onSubmit={handleSave} noValidate>
              <div className="row g-3">
                <div className="col-md-8">
                  <label className="form-label-custom">Hospital Name *</label>
                  <input
                    type="text"
                    className={`form-input-custom ${formErrors.name ? 'error' : ''}`}
                    value={form.name}
                    onChange={e => { setForm({ ...form, name: e.target.value }); clearError('name') }}
                    maxLength={150}
                  />
                  {formErrors.name && <span className="form-error"><i className="bi bi-exclamation-circle" />{formErrors.name}</span>}
                </div>
                <div className="col-md-4">
                  <label className="form-label-custom">Type</label>
                  <select className="form-input-custom" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                    <option value="">None</option>
                    {Object.entries(TYPE_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label-custom">Registration Number</label>
                  <input
                    type="text"
                    className="form-input-custom"
                    value={form.registration_number}
                    onChange={e => setForm({ ...form, registration_number: e.target.value })}
                    maxLength={100}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label-custom">Bed Count</label>
                  <input
                    type="number"
                    min={0}
                    className={`form-input-custom ${formErrors.bed_count ? 'error' : ''}`}
                    value={form.bed_count}
                    onChange={e => { setForm({ ...form, bed_count: e.target.value }); clearError('bed_count') }}
                  />
                  {formErrors.bed_count && <span className="form-error"><i className="bi bi-exclamation-circle" />{formErrors.bed_count}</span>}
                </div>

                <div className="col-12">
                  <label className="form-label-custom">Address</label>
                  <input
                    type="text"
                    className="form-input-custom"
                    value={form.address}
                    onChange={e => setForm({ ...form, address: e.target.value })}
                    maxLength={250}
                  />
                </div>
                <div className="col-md-5">
                  <label className="form-label-custom">City</label>
                  <input type="text" className="form-input-custom" value={form.city}
                    onChange={e => setForm({ ...form, city: e.target.value })} maxLength={100} />
                </div>
                <div className="col-md-4">
                  <label className="form-label-custom">State</label>
                  <input type="text" className="form-input-custom" value={form.state}
                    onChange={e => setForm({ ...form, state: e.target.value })} maxLength={100} />
                </div>
                <div className="col-md-3">
                  <label className="form-label-custom">Pincode</label>
                  <input type="text" className="form-input-custom" value={form.pincode}
                    onChange={e => setForm({ ...form, pincode: e.target.value })} maxLength={10} />
                </div>

                <div className="col-md-6">
                  <label className="form-label-custom">Phone</label>
                  <input type="tel" className="form-input-custom" value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })} maxLength={15} />
                </div>
                <div className="col-md-6">
                  <label className="form-label-custom">Email</label>
                  <input
                    type="email"
                    className={`form-input-custom ${formErrors.email ? 'error' : ''}`}
                    value={form.email}
                    onChange={e => { setForm({ ...form, email: e.target.value }); clearError('email') }}
                    maxLength={254}
                  />
                  {formErrors.email && <span className="form-error"><i className="bi bi-exclamation-circle" />{formErrors.email}</span>}
                </div>

                <div className="col-12">
                  <label className="form-label-custom">Website</label>
                  <input
                    type="text"
                    className={`form-input-custom ${formErrors.website ? 'error' : ''}`}
                    value={form.website}
                    onChange={e => { setForm({ ...form, website: e.target.value }); clearError('website') }}
                    placeholder="https://example.com"
                    maxLength={200}
                  />
                  {formErrors.website && <span className="form-error"><i className="bi bi-exclamation-circle" />{formErrors.website}</span>}
                </div>
              </div>

              <div className="d-flex gap-3 mt-4">
                <button type="button" className="btn-ghost flex-fill" onClick={() => setShowEdit(false)}>Cancel</button>
                <button type="submit" className="btn-primary-custom flex-fill justify-content-center" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
