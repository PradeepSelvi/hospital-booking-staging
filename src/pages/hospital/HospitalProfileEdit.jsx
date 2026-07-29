import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { toast } from 'react-toastify'
import {
  getHospitalByOwnerId, updateHospitalProfile, updateHospitalSummary,
  getHospitalPhotos, uploadHospitalPhoto, deleteHospitalPhoto,
  updatePhotoCaption, reorderHospitalPhotos, uploadCoverPhoto,
  uploadHospitalSummaryDoc, deleteHospitalSummaryDoc, getSummaryDocUrl,
  getPhotoUrl, validateWebsiteUrl,
  HOSPITAL_DOC_CONSTRAINTS,
} from '../../services/hospital'
import ProfileTabs from '../../components/ProfileTabs'
import HospitalLocationMap from '../../components/HospitalLocationMap'
import HospitalPhotoManager from '../../components/HospitalPhotoManager'
import AccountClosure from '../../components/AccountClosure'
import { SkeletonProfilePage } from '../../components/SkeletonLoader'
import './HospitalProfileEdit.css'

const TABS = ['Basic Info', 'Location', 'Summary', 'Photos']
const TAB_ICONS = ['bi-building', 'bi-geo-alt', 'bi-card-text', 'bi-camera']

export default function HospitalProfileEdit() {
  const { user } = useAuth()
  const [hospital, setHospital] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState(0)

  const [form, setForm] = useState(getEmptyForm())
  const [photos, setPhotos] = useState([])
  const [photoUploading, setPhotoUploading] = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)
  const [docUploading, setDocUploading] = useState(false)
  const coverRef = useRef(null)
  const docRef = useRef(null)

  function getEmptyForm() {
    return {
      name: '', type: '', registration_number: '', bed_count: '',
      address: '', city: '', state: '', pincode: '',
      latitude: '', longitude: '',
      phone: '', email: '', website: '',
      summary_text: '',
    }
  }

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData() {
    try {
      setLoading(true)
      const h = await getHospitalByOwnerId(user.id)
      setHospital(h)
      if (h) {
        setForm({
          name: h.name || '',
          type: h.type || '',
          registration_number: h.registration_number || '',
          bed_count: h.bed_count ?? '',
          address: h.address || '',
          city: h.city || '',
          state: h.state || '',
          pincode: h.pincode || '',
          latitude: h.latitude ?? '',
          longitude: h.longitude ?? '',
          phone: h.phone || '',
          email: h.email || '',
          website: h.website || '',
          summary_text: h.summary_text || '',
        })
        const pics = await getHospitalPhotos(h.id)
        setPhotos(pics)
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load hospital profile')
    } finally {
      setLoading(false)
    }
  }

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSaveBasic(e) {
    e?.preventDefault()
    if (!form.name.trim()) { toast.error('Hospital name is required'); return }
    if (form.website) {
      const check = validateWebsiteUrl(form.website)
      if (!check.valid) { toast.error(check.error); return }
    }
    try {
      setSaving(true)
      const updated = await updateHospitalProfile(hospital.id, form)
      setHospital(updated)
      toast.success('Hospital details saved!')
    } catch (err) {
      toast.error(err.message || 'Failed to save details')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveSummary() {
    try {
      setSaving(true)
      const updated = await updateHospitalSummary(hospital.id, form.summary_text)
      setHospital(updated)
      toast.success('Summary saved!')
    } catch (err) {
      toast.error(err.message || 'Failed to save summary')
    } finally {
      setSaving(false)
    }
  }

  // ── Cover photo ──
  async function handleCoverUpload(file) {
    if (!file) return
    try {
      setCoverUploading(true)
      const path = await uploadCoverPhoto(file, hospital.id)
      setHospital(prev => ({ ...prev, cover_photo_url: path }))
      toast.success('Cover photo updated!')
    } catch (err) {
      toast.error(err.message || 'Failed to upload cover photo')
    } finally {
      setCoverUploading(false)
    }
  }

  // ── Gallery ──
  async function handlePhotoUpload(file) {
    try {
      setPhotoUploading(true)
      const created = await uploadHospitalPhoto(file, hospital.id, user.id)
      setPhotos(prev => [...prev, created])
      toast.success('Photo uploaded!')
    } catch (err) {
      toast.error(err.message || 'Failed to upload photo')
    } finally {
      setPhotoUploading(false)
    }
  }

  async function handlePhotoDelete(photoId) {
    if (!confirm('Remove this photo?')) return
    try {
      await deleteHospitalPhoto(photoId)
      setPhotos(prev => prev.filter(p => p.id !== photoId))
      toast.success('Photo removed')
    } catch (err) {
      toast.error(err.message || 'Failed to remove photo')
    }
  }

  async function handleCaptionSave(photoId, caption) {
    try {
      await updatePhotoCaption(photoId, caption)
      setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, caption } : p))
      toast.success('Caption saved')
    } catch (err) {
      toast.error('Failed to save caption')
    }
  }

  async function handleReorder(orderedIds) {
    // Optimistic reorder
    const map = new Map(photos.map(p => [p.id, p]))
    setPhotos(orderedIds.map((id, i) => ({ ...map.get(id), display_order: i })))
    try {
      await reorderHospitalPhotos(orderedIds)
    } catch (err) {
      toast.error('Failed to save new order')
      loadData()
    }
  }

  // ── Summary document ──
  async function handleDocUpload(file) {
    if (!file) return
    try {
      setDocUploading(true)
      const path = await uploadHospitalSummaryDoc(file, hospital.id)
      setHospital(prev => ({ ...prev, summary_doc_url: path }))
      toast.success('Document uploaded!')
    } catch (err) {
      toast.error(err.message || 'Failed to upload document')
    } finally {
      setDocUploading(false)
    }
  }

  async function handleDocDelete() {
    try {
      setDocUploading(true)
      await deleteHospitalSummaryDoc(hospital.id)
      setHospital(prev => ({ ...prev, summary_doc_url: null }))
      toast.success('Document removed')
    } catch (err) {
      toast.error('Failed to remove document')
    } finally {
      setDocUploading(false)
    }
  }

  async function handleDocDownload() {
    const url = await getSummaryDocUrl(hospital.summary_doc_url)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else toast.error('Could not generate download link')
  }

  if (loading) return <SkeletonProfilePage />

  if (!hospital) return (
    <div className="card-custom p-4">
      <div className="empty-state" style={{ padding: 48 }}>
        <i className="bi bi-hospital" style={{ fontSize: 48, color: 'var(--gray-300)' }} />
        <p style={{ fontWeight: 600, color: 'var(--gray-500)', marginTop: 16 }}>No hospital profile found</p>
        <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Please contact the administrator.</p>
      </div>
    </div>
  )

  const coverUrl = getPhotoUrl(hospital.cover_photo_url)

  return (
    <div className="hospital-profile-edit">
      <div className="mb-4">
        <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
          Hospital Profile
        </h4>
        <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
          Manage your hospital's information, location, summary, and photos
        </p>
      </div>

      {/* Cover banner */}
      <div className="hospital-cover" style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}>
        {!coverUrl && <i className="bi bi-image hospital-cover-placeholder" />}
        <button
          type="button"
          className="hospital-cover-btn"
          disabled={coverUploading}
          onClick={() => coverRef.current?.click()}
        >
          {coverUploading ? (
            <><div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} /> Uploading...</>
          ) : (
            <><i className="bi bi-camera me-1" />{coverUrl ? 'Change Cover' : 'Add Cover Photo'}</>
          )}
        </button>
        <input
          ref={coverRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          style={{ display: 'none' }}
          onChange={(e) => { handleCoverUpload(e.target.files?.[0]); e.target.value = '' }}
        />
        <div className="hospital-cover-title">
          <i className="bi bi-hospital me-2" />{form.name || hospital.name}
        </div>
      </div>

      <ProfileTabs tabs={TABS} icons={TAB_ICONS} activeTab={activeTab} onChange={setActiveTab} />

      <div className="card-custom p-4 hospital-tab-panel">
        {/* ── Basic Info ── */}
        {activeTab === 0 && (
          <form onSubmit={handleSaveBasic}>
            <div className="row g-3">
              <div className="col-md-8">
                <label className="form-label-custom required">Hospital Name</label>
                <input type="text" className="form-input-custom" maxLength={200}
                  placeholder="e.g. Apollo Hospitals"
                  value={form.name} onChange={e => update('name', e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label-custom">Type</label>
                <select className="form-input-custom" value={form.type} onChange={e => update('type', e.target.value)}>
                  <option value="">Select type</option>
                  <option value="PRIVATE">Private Hospital</option>
                  <option value="GOVERNMENT">Government Hospital</option>
                  <option value="CLINIC">Clinic</option>
                  <option value="MULTI_SPECIALTY">Multi-Specialty</option>
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label-custom">Registration / License No.</label>
                <input type="text" className="form-input-custom" maxLength={50}
                  value={form.registration_number} onChange={e => update('registration_number', e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label-custom">Bed Count</label>
                <input type="number" className="form-input-custom" min={0} max={10000}
                  value={form.bed_count} onChange={e => update('bed_count', e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label-custom">Phone</label>
                <input type="tel" className="form-input-custom" maxLength={15}
                  placeholder="+91 98765 43210"
                  value={form.phone} onChange={e => update('phone', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label-custom">Email</label>
                <input type="email" className="form-input-custom" maxLength={120}
                  placeholder="contact@hospital.com"
                  value={form.email} onChange={e => update('email', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label-custom">Website</label>
                <input type="url" className="form-input-custom"
                  placeholder="https://www.hospital.com"
                  value={form.website} onChange={e => update('website', e.target.value)} />
              </div>
            </div>
            <div className="d-flex justify-content-end mt-4">
              <button type="submit" className="btn-primary-custom" disabled={saving}>
                {saving ? (<><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> Saving...</>)
                  : (<><i className="bi bi-check-circle me-1" />Save Changes</>)}
              </button>
            </div>
          </form>
        )}

        {/* ── Location ── */}
        {activeTab === 1 && (
          <form onSubmit={handleSaveBasic}>
            <div className="row g-3">
              <div className="col-12">
                <label className="form-label-custom">Street Address</label>
                <input type="text" className="form-input-custom" maxLength={300}
                  placeholder="Full street address"
                  value={form.address} onChange={e => update('address', e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label-custom">City</label>
                <input type="text" className="form-input-custom" maxLength={100}
                  value={form.city} onChange={e => update('city', e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label-custom">State</label>
                <input type="text" className="form-input-custom" maxLength={100}
                  value={form.state} onChange={e => update('state', e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label-custom">PIN Code</label>
                <input type="text" className="form-input-custom" maxLength={10}
                  value={form.pincode} onChange={e => update('pincode', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label-custom">Latitude</label>
                <input type="number" className="form-input-custom" step="0.00000001" min={-90} max={90}
                  placeholder="19.07609"
                  value={form.latitude} onChange={e => update('latitude', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label-custom">Longitude</label>
                <input type="number" className="form-input-custom" step="0.00000001" min={-180} max={180}
                  placeholder="72.87741"
                  value={form.longitude} onChange={e => update('longitude', e.target.value)} />
              </div>
              <div className="col-12">
                <HospitalLocationMap
                  latitude={form.latitude}
                  longitude={form.longitude}
                  editable={true}
                  onLocationChange={(lat, lng) => { update('latitude', lat); update('longitude', lng) }}
                  hospitalName={form.name || 'Hospital'}
                  hospitalAddress={[form.address, form.city, form.state].filter(Boolean).join(', ')}
                  height="320px"
                />
              </div>
            </div>
            <div className="d-flex justify-content-end mt-4">
              <button type="submit" className="btn-primary-custom" disabled={saving}>
                {saving ? (<><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> Saving...</>)
                  : (<><i className="bi bi-check-circle me-1" />Save Location</>)}
              </button>
            </div>
          </form>
        )}

        {/* ── Summary ── */}
        {activeTab === 2 && (
          <div>
            <label className="form-label-custom">Hospital Summary</label>
            <textarea
              className="form-input-custom" rows={6} maxLength={3000}
              placeholder="Describe your hospital — services, specialties, infrastructure, achievements..."
              value={form.summary_text}
              onChange={e => update('summary_text', e.target.value)}
              style={{ resize: 'vertical', minHeight: 140 }}
            />
            <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
              {form.summary_text.length} / 3000
            </div>

            <div className="d-flex justify-content-end mb-4">
              <button type="button" className="btn-primary-custom" disabled={saving} onClick={handleSaveSummary}>
                {saving ? (<><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> Saving...</>)
                  : (<><i className="bi bi-check-circle me-1" />Save Summary</>)}
              </button>
            </div>

            {/* Brochure / Summary document */}
            <div className="hospital-form-section">
              <div className="hospital-form-section-title">
                <i className="bi bi-file-earmark-text" />Summary Document (Brochure)
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--gray-400)', marginLeft: 8 }}>
                  {HOSPITAL_DOC_CONSTRAINTS.label} • Max {HOSPITAL_DOC_CONSTRAINTS.maxSizeLabel}
                </span>
              </div>
              {hospital.summary_doc_url ? (
                <div className="d-flex align-items-center gap-3 p-3" style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md, 10px)' }}>
                  <i className="bi bi-file-earmark-check" style={{ fontSize: 24, color: 'var(--success)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{hospital.summary_doc_url.split('/').pop()}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>Document uploaded</div>
                  </div>
                  <button type="button" className="btn-ghost" style={{ fontSize: 12, color: 'var(--primary)' }} onClick={handleDocDownload}>
                    <i className="bi bi-download me-1" />View
                  </button>
                  <button type="button" className="btn-ghost" style={{ fontSize: 12, color: 'var(--danger)' }}
                    onClick={handleDocDelete} disabled={docUploading}>
                    <i className="bi bi-trash me-1" />Remove
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    ref={docRef}
                    type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="form-input-custom" style={{ padding: '10px 14px' }}
                    onChange={e => { handleDocUpload(e.target.files?.[0]); e.target.value = '' }}
                  />
                  {docUploading && (
                    <div className="d-flex align-items-center gap-2 mt-2" style={{ fontSize: 12, color: 'var(--primary)' }}>
                      <div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} />
                      Uploading document...
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Photos ── */}
        {activeTab === 3 && (
          <HospitalPhotoManager
            photos={photos}
            uploading={photoUploading}
            onUpload={handlePhotoUpload}
            onDelete={handlePhotoDelete}
            onCaptionSave={handleCaptionSave}
            onReorder={handleReorder}
          />
        )}
      </div>

      {/* Account Closure */}
      <AccountClosure role="HOSPITAL" />
    </div>
  )
}
