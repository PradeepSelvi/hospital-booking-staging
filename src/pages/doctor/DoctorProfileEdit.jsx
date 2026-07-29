import { useState, useEffect, useRef } from 'react'
import { getDoctorByUserId, updateDoctorProfile } from '../../services/doctors'
import { getDepartments } from '../../services/admin'
import { getProfile, updateProfile, uploadAvatar, deleteAvatar } from '../../services/profiles'
import {
  getHospitalsByDoctorId, createHospital, updateHospital, deleteHospital,
  uploadHospitalPhoto, deleteHospitalPhoto, getHospitalPhotoUrl,
  uploadHospitalDocument, deleteHospitalDocument, getHospitalDocumentUrl,
  validateHospitalPhoto, validateHospitalDocument, validateWebsiteUrl,
  HOSPITAL_FILE_CONSTRAINTS, MAX_HOSPITALS_PER_DOCTOR
} from '../../services/hospitalInfo'
import { useAuth } from '../../context/AuthContext'
import { toast } from 'react-toastify'
import AvatarUpload from '../../components/AvatarUpload'
import PasswordChange from '../../components/PasswordChange'
import ProfileTabs from '../../components/ProfileTabs'
import HospitalLocationMap from '../../components/HospitalLocationMap'
import HospitalPhotoGallery from '../../components/HospitalPhotoGallery'
import DoctorHospitalSelector from '../../components/DoctorHospitalSelector'
import {
  getDoctorAffiliations, requestDoctorAffiliation, removeAffiliation,
  setPrimaryAffiliation, getPhotoUrl as getHospitalCoverUrl,
} from '../../services/hospital'
import { SkeletonProfilePage } from '../../components/SkeletonLoader'
import { validateField, validatePhone, RULES } from '../../security/validators'
import AccountClosure from '../../components/AccountClosure'

export default function DoctorProfileEdit() {
  const { user, profile: authProfile, refreshProfile } = useAuth()
  const [doctor, setDoctor] = useState(null)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activeTab, setActiveTab] = useState(0)

  // Personal info
  const [personalForm, setPersonalForm] = useState({
    name: '', phone: '', bio: '', avatar_url: null
  })

  // Professional info
  const [profForm, setProfForm] = useState({
    specialization: '', qualification: '', experience_years: 0,
    consultation_fee: 0, department_id: '', registration_number: '',
    languages: [], availability_status: 'AVAILABLE'
  })

  // Languages input
  const [langInput, setLangInput] = useState('')

  // Hospital info
  const [hospitals, setHospitals] = useState([])
  const [hospitalLoading, setHospitalLoading] = useState(false)
  const [hospitalSaving, setHospitalSaving] = useState(null) // hospital ID being saved
  const [expandedHospital, setExpandedHospital] = useState(null)
  const [showAddHospital, setShowAddHospital] = useState(false)
  const [newHospitalForm, setNewHospitalForm] = useState(getEmptyHospitalForm())
  const [editForms, setEditForms] = useState({}) // { [hospitalId]: formData }
  const [photoUploading, setPhotoUploading] = useState(null) // 'hospitalId-slot'
  const [docUploading, setDocUploading] = useState(null)
  const photoInputRefs = useRef({})
  const docInputRefs = useRef({})

  // Hospital affiliations (first-class hospitals the doctor has joined)
  const [affiliations, setAffiliations] = useState([])
  const [showJoinPanel, setShowJoinPanel] = useState(false)
  const [joiningId, setJoiningId] = useState(null)
  const [affActionId, setAffActionId] = useState(null)

  function getEmptyHospitalForm() {
    return {
      hospital_name: '', hospital_type: '', hospital_summary: '',
      bed_count: '', registration_number: '',
      address: '', city: '', state: '', pincode: '',
      latitude: '', longitude: '',
      phone: '', email: '', website_url: '',
    }
  }

  useEffect(() => {
    if (user) loadProfile()
  }, [user])

  async function loadProfile() {
    try {
      setLoading(true)
      const [doc, profile, depts] = await Promise.all([
        getDoctorByUserId(user.id),
        getProfile(user.id),
        getDepartments()
      ])

      setDoctor(doc)
      setDepartments(depts)

      setPersonalForm({
        name: profile.name || '',
        phone: profile.phone || '',
        bio: profile.bio || doc?.bio || '',
        avatar_url: profile.avatar_url || null
      })

      if (doc) {
        setProfForm({
          specialization: doc.specialization || '',
          qualification: doc.qualification || '',
          experience_years: doc.experience_years ?? 0,
          consultation_fee: doc.consultation_fee ?? 0,
          department_id: doc.department_id || '',
          registration_number: doc.registration_number || '',
          languages: doc.languages || [],
          availability_status: doc.availability_status || 'AVAILABLE'
        })
      }
      // Load hospital info
      if (doc) {
        try {
          const hospitalData = await getHospitalsByDoctorId(doc.id)
          setHospitals(hospitalData)
          // Initialize edit forms
          const forms = {}
          hospitalData.forEach(h => {
            forms[h.id] = { ...h }
          })
          setEditForms(forms)
          if (hospitalData.length > 0) setExpandedHospital(hospitalData[0].id)
        } catch (hospErr) {
          console.error('Failed to load hospitals:', hospErr)
        }

        // Load first-class hospital affiliations
        try {
          const affData = await getDoctorAffiliations(doc.id)
          setAffiliations(affData)
        } catch (affErr) {
          console.error('Failed to load affiliations:', affErr)
        }
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  async function handleSavePersonal(e) {
    e.preventDefault()
    const errs = {}
    const nameResult = validateField('name', personalForm.name, { required: true })
    if (!nameResult.valid) errs.name = nameResult.message
    const phoneResult = validatePhone(personalForm.phone)
    if (!phoneResult.valid) errs.phone = phoneResult.message
    const bioResult = validateField('bio', personalForm.bio)
    if (!bioResult.valid) errs.bio = bioResult.message
    if (Object.keys(errs).length > 0) {
      Object.values(errs).forEach(msg => toast.error(msg))
      return
    }
    try {
      setSaving(true)
      await updateProfile(user.id, {
        name: personalForm.name.trim(),
        phone: personalForm.phone.trim(),
        bio: personalForm.bio.trim()
      })
      await refreshProfile()
      toast.success('Personal information saved!')
    } catch (err) {
      toast.error('Failed to save personal info')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveProfessional(e) {
    e.preventDefault()
    if (!doctor) return
    const errs = {}
    const specResult = validateField('specialization', profForm.specialization, { required: true })
    if (!specResult.valid) errs.specialization = specResult.message
    if (profForm.qualification) {
      const qualResult = validateField('qualification', profForm.qualification)
      if (!qualResult.valid) errs.qualification = qualResult.message
    }
    if (profForm.registration_number) {
      const regResult = validateField('registrationNumber', profForm.registration_number)
      if (!regResult.valid) errs.registration_number = regResult.message
    }
    const expResult = validateField('experienceYears', profForm.experience_years)
    if (!expResult.valid) errs.experience_years = expResult.message
    const feeResult = validateField('consultationFee', profForm.consultation_fee)
    if (!feeResult.valid) errs.consultation_fee = feeResult.message
    if (Object.keys(errs).length > 0) {
      Object.values(errs).forEach(msg => toast.error(msg))
      return
    }
    try {
      setSaving(true)
      await updateDoctorProfile(doctor.id, {
        specialization: profForm.specialization,
        qualification: profForm.qualification,
        experience_years: profForm.experience_years,
        consultation_fee: profForm.consultation_fee,
        department_id: profForm.department_id || null,
        registration_number: profForm.registration_number || null,
        languages: profForm.languages.length > 0 ? profForm.languages : null,
        availability_status: profForm.availability_status
      })
      toast.success('Professional details saved!')
    } catch (err) {
      toast.error('Failed to save professional details')
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarUpload(file) {
    try {
      setUploading(true)
      const url = await uploadAvatar(user.id, file)
      setPersonalForm(prev => ({ ...prev, avatar_url: url }))
      await refreshProfile()
      toast.success('Photo updated!')
    } catch (err) {
      toast.error('Failed to upload photo')
    } finally {
      setUploading(false)
    }
  }

  async function handleAvatarRemove() {
    try {
      setUploading(true)
      await deleteAvatar(user.id)
      setPersonalForm(prev => ({ ...prev, avatar_url: null }))
      await refreshProfile()
      toast.success('Photo removed')
    } catch (err) {
      toast.error('Failed to remove photo')
    } finally {
      setUploading(false)
    }
  }

  function addLanguage() {
    const lang = langInput.trim()
    if (!lang) return
    // Validate language name
    const langResult = validateField('language', lang)
    if (!langResult.valid) {
      toast.error(langResult.message)
      return
    }
    if (profForm.languages.includes(lang)) {
      toast.error('Language already added')
      return
    }
    setProfForm(prev => ({ ...prev, languages: [...prev.languages, lang] }))
    setLangInput('')
  }

  function removeLanguage(lang) {
    setProfForm(prev => ({
      ...prev,
      languages: prev.languages.filter(l => l !== lang)
    }))
  }

  // ── Hospital CRUD Handlers ──
  async function handleAddHospital(e) {
    e.preventDefault()
    if (!newHospitalForm.hospital_name.trim()) {
      toast.error('Hospital name is required')
      return
    }
    if (newHospitalForm.website_url) {
      const urlCheck = validateWebsiteUrl(newHospitalForm.website_url)
      if (!urlCheck.valid) { toast.error(urlCheck.error); return }
    }
    try {
      setHospitalSaving('new')
      const created = await createHospital(doctor.id, {
        ...newHospitalForm,
        bed_count: newHospitalForm.bed_count ? parseInt(newHospitalForm.bed_count) : null,
        latitude: newHospitalForm.latitude ? parseFloat(newHospitalForm.latitude) : null,
        longitude: newHospitalForm.longitude ? parseFloat(newHospitalForm.longitude) : null,
      })
      setHospitals(prev => [...prev, created])
      setEditForms(prev => ({ ...prev, [created.id]: { ...created } }))
      setNewHospitalForm(getEmptyHospitalForm())
      setShowAddHospital(false)
      setExpandedHospital(created.id)
      toast.success('Hospital added successfully!')
    } catch (err) {
      toast.error(err.message || 'Failed to add hospital')
    } finally {
      setHospitalSaving(null)
    }
  }

  async function handleUpdateHospital(hospitalId) {
    const form = editForms[hospitalId]
    if (!form?.hospital_name?.trim()) {
      toast.error('Hospital name is required')
      return
    }
    if (form.website_url) {
      const urlCheck = validateWebsiteUrl(form.website_url)
      if (!urlCheck.valid) { toast.error(urlCheck.error); return }
    }
    try {
      setHospitalSaving(hospitalId)
      const updated = await updateHospital(hospitalId, {
        ...form,
        bed_count: form.bed_count ? parseInt(form.bed_count) : null,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
      })
      setHospitals(prev => prev.map(h => h.id === hospitalId ? updated : h))
      setEditForms(prev => ({ ...prev, [hospitalId]: { ...updated } }))
      toast.success('Hospital info saved!')
    } catch (err) {
      toast.error(err.message || 'Failed to update hospital')
    } finally {
      setHospitalSaving(null)
    }
  }

  async function handleDeleteHospital(hospitalId) {
    if (!confirm('Are you sure you want to remove this hospital? All photos and documents will be deleted.')) return
    try {
      setHospitalSaving(hospitalId)
      await deleteHospital(hospitalId)
      setHospitals(prev => prev.filter(h => h.id !== hospitalId))
      setEditForms(prev => { const n = { ...prev }; delete n[hospitalId]; return n })
      if (expandedHospital === hospitalId) setExpandedHospital(null)
      toast.success('Hospital removed')
    } catch (err) {
      toast.error(err.message || 'Failed to remove hospital')
    } finally {
      setHospitalSaving(null)
    }
  }

  async function handlePhotoUpload(hospitalId, slot, file) {
    const validation = validateHospitalPhoto(file)
    if (!validation.valid) { toast.error(validation.error); return }
    try {
      setPhotoUploading(`${hospitalId}-${slot}`)
      const path = await uploadHospitalPhoto(file, doctor.id, hospitalId, slot)
      // Refresh hospital data
      const updated = hospitals.map(h => {
        if (h.id === hospitalId) {
          const key = slot === 1 ? 'photo_1_url' : 'photo_2_url'
          return { ...h, [key]: path }
        }
        return h
      })
      setHospitals(updated)
      setEditForms(prev => ({
        ...prev,
        [hospitalId]: { ...prev[hospitalId], [slot === 1 ? 'photo_1_url' : 'photo_2_url']: path }
      }))
      toast.success('Photo uploaded!')
    } catch (err) {
      toast.error(err.message || 'Failed to upload photo')
    } finally {
      setPhotoUploading(null)
    }
  }

  async function handlePhotoDelete(hospitalId, slot) {
    try {
      setPhotoUploading(`${hospitalId}-${slot}`)
      await deleteHospitalPhoto(hospitalId, slot)
      const key = slot === 1 ? 'photo_1_url' : 'photo_2_url'
      setHospitals(prev => prev.map(h => h.id === hospitalId ? { ...h, [key]: null } : h))
      setEditForms(prev => ({ ...prev, [hospitalId]: { ...prev[hospitalId], [key]: null } }))
      toast.success('Photo removed')
    } catch (err) {
      toast.error('Failed to remove photo')
    } finally {
      setPhotoUploading(null)
    }
  }

  async function handleDocUpload(hospitalId, file) {
    const validation = validateHospitalDocument(file)
    if (!validation.valid) { toast.error(validation.error); return }
    try {
      setDocUploading(hospitalId)
      const path = await uploadHospitalDocument(file, doctor.id, hospitalId)
      setHospitals(prev => prev.map(h => h.id === hospitalId ? { ...h, document_url: path } : h))
      setEditForms(prev => ({ ...prev, [hospitalId]: { ...prev[hospitalId], document_url: path } }))
      toast.success('Document uploaded!')
    } catch (err) {
      toast.error(err.message || 'Failed to upload document')
    } finally {
      setDocUploading(null)
    }
  }

  async function handleDocDelete(hospitalId) {
    try {
      setDocUploading(hospitalId)
      await deleteHospitalDocument(hospitalId)
      setHospitals(prev => prev.map(h => h.id === hospitalId ? { ...h, document_url: null } : h))
      setEditForms(prev => ({ ...prev, [hospitalId]: { ...prev[hospitalId], document_url: null } }))
      toast.success('Document removed')
    } catch (err) {
      toast.error('Failed to remove document')
    } finally {
      setDocUploading(null)
    }
  }

  // ── Affiliation Handlers (first-class hospitals) ──
  async function handleJoinHospital(hospitalItem) {
    if (!doctor) return
    try {
      setJoiningId(hospitalItem.id)
      const created = await requestDoctorAffiliation(doctor.id, hospitalItem.id, affiliations.length === 0)
      setAffiliations(prev => [{ ...created, hospitals: hospitalItem }, ...prev])
      setShowJoinPanel(false)
      toast.success(`You've joined ${hospitalItem.name}!`)
    } catch (err) {
      toast.error(err.message || 'Failed to join hospital')
    } finally {
      setJoiningId(null)
    }
  }

  async function handleLeaveHospital(aff) {
    if (!confirm(`Leave ${aff.hospitals?.name ?? 'this hospital'}?`)) return
    try {
      setAffActionId(aff.id)
      await removeAffiliation(aff.id, doctor.id, aff.hospital_id)
      setAffiliations(prev => prev.filter(a => a.id !== aff.id))
      toast.success('You have left the hospital')
    } catch (err) {
      toast.error(err.message || 'Failed to leave hospital')
    } finally {
      setAffActionId(null)
    }
  }

  async function handleSetPrimary(aff) {
    try {
      setAffActionId(aff.id)
      await setPrimaryAffiliation(aff.id, doctor.id, aff.hospital_id)
      setAffiliations(prev => prev.map(a => ({ ...a, is_primary: a.id === aff.id })))
      toast.success(`${aff.hospitals?.name ?? 'Hospital'} set as primary`)
    } catch (err) {
      toast.error(err.message || 'Failed to set primary hospital')
    } finally {
      setAffActionId(null)
    }
  }

  function updateEditForm(hospitalId, field, value) {
    setEditForms(prev => ({
      ...prev,
      [hospitalId]: { ...prev[hospitalId], [field]: value }
    }))
  }

  function renderHospitalForm(form, onChange, hospitalId = null) {
    const isExisting = hospitalId !== null
    const hospital = isExisting ? hospitals.find(h => h.id === hospitalId) : null

    return (
      <>
        {/* Basic Info */}
        <div className="hospital-form-section">
          <div className="hospital-form-section-title">
            <i className="bi bi-building" />Basic Information
          </div>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label-custom required">Hospital / Clinic Name</label>
              <input
                type="text" className="form-input-custom" maxLength={200}
                placeholder="e.g. Apollo Hospitals"
                value={form.hospital_name || ''}
                onChange={e => onChange('hospital_name', e.target.value)}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label-custom">Hospital Type</label>
              <select
                className="form-input-custom"
                value={form.hospital_type || ''}
                onChange={e => onChange('hospital_type', e.target.value)}
              >
                <option value="">Select type</option>
                <option value="PRIVATE">Private Hospital</option>
                <option value="GOVERNMENT">Government Hospital</option>
                <option value="CLINIC">Clinic</option>
                <option value="MULTI_SPECIALTY">Multi-Specialty</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label-custom">Bed Count</label>
              <input
                type="number" className="form-input-custom" min={0} max={10000}
                value={form.bed_count || ''}
                onChange={e => onChange('bed_count', e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label-custom">Registration / License No.</label>
              <input
                type="text" className="form-input-custom" maxLength={50}
                placeholder="Hospital License Number"
                value={form.registration_number || ''}
                onChange={e => onChange('registration_number', e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label-custom">Phone</label>
              <input
                type="tel" className="form-input-custom" maxLength={15}
                placeholder="+91 98765 43210"
                value={form.phone || ''}
                onChange={e => onChange('phone', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="hospital-form-section">
          <div className="hospital-form-section-title">
            <i className="bi bi-card-text" />Hospital Summary
          </div>
          <textarea
            className="form-input-custom" rows={4} maxLength={3000}
            placeholder="Describe your hospital — services, specialties, infrastructure, achievements..."
            value={form.hospital_summary || ''}
            onChange={e => onChange('hospital_summary', e.target.value)}
            style={{ resize: 'vertical', minHeight: 100 }}
          />
          <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
            {(form.hospital_summary || '').length} / 3000
          </div>
        </div>

        {/* Photos — only for existing hospitals */}
        {isExisting && (
          <div className="hospital-form-section">
            <div className="hospital-form-section-title">
              <i className="bi bi-camera" />Hospital Photos
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--gray-400)', marginLeft: 8 }}>
                Max 2 photos • {HOSPITAL_FILE_CONSTRAINTS.photo.maxSizeLabel} each • {HOSPITAL_FILE_CONSTRAINTS.photo.label}
              </span>
            </div>
            <div className="hospital-photo-upload-grid">
              {[1, 2].map(slot => {
                const photoPath = slot === 1 ? hospital?.photo_1_url : hospital?.photo_2_url
                const photoUrl = getHospitalPhotoUrl(photoPath)
                const isUploading = photoUploading === `${hospitalId}-${slot}`
                const refKey = `${hospitalId}-${slot}`

                return (
                  <div key={slot} className={`hospital-photo-upload-slot ${photoUrl ? 'has-photo' : ''}`}
                    onClick={() => !photoUrl && photoInputRefs.current[refKey]?.click()}
                  >
                    {isUploading ? (
                      <div className="d-flex flex-column align-items-center gap-2">
                        <div className="spinner-custom" style={{ width: 24, height: 24 }} />
                        <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Uploading...</span>
                      </div>
                    ) : photoUrl ? (
                      <div className="photo-preview-wrapper">
                        <img src={photoUrl} alt={`Hospital photo ${slot}`} />
                        <button
                          type="button" className="photo-remove-btn"
                          onClick={(e) => { e.stopPropagation(); handlePhotoDelete(hospitalId, slot) }}
                        >
                          <i className="bi bi-trash" />
                        </button>
                        <span className="photo-slot-label">Photo {slot}</span>
                      </div>
                    ) : (
                      <>
                        <i className="bi bi-image upload-placeholder-icon" />
                        <span className="upload-placeholder-text">Upload Photo {slot}</span>
                        <span className="upload-placeholder-hint">
                          {HOSPITAL_FILE_CONSTRAINTS.photo.label} • Max {HOSPITAL_FILE_CONSTRAINTS.photo.maxSizeLabel}
                        </span>
                      </>
                    )}
                    <input
                      ref={el => photoInputRefs.current[refKey] = el}
                      type="file" accept=".jpg,.jpeg,.png,.webp"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handlePhotoUpload(hospitalId, slot, file)
                        e.target.value = ''
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Documents — only for existing hospitals */}
        {isExisting && (
          <div className="hospital-form-section">
            <div className="hospital-form-section-title">
              <i className="bi bi-file-earmark-text" />Supporting Documents
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--gray-400)', marginLeft: 8 }}>
                {HOSPITAL_FILE_CONSTRAINTS.document.label} • Max {HOSPITAL_FILE_CONSTRAINTS.document.maxSizeLabel}
              </span>
            </div>
            {hospital?.document_url ? (
              <div className="d-flex align-items-center gap-3 p-3" style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md, 10px)' }}>
                <i className="bi bi-file-earmark-check" style={{ fontSize: 24, color: 'var(--success)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{hospital.document_url.split('/').pop()}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>Document uploaded</div>
                </div>
                <button type="button" className="btn-ghost" style={{ fontSize: 12, color: 'var(--danger)' }}
                  onClick={() => handleDocDelete(hospitalId)}
                  disabled={docUploading === hospitalId}
                >
                  <i className="bi bi-trash me-1" />Remove
                </button>
              </div>
            ) : (
              <div>
                <input
                  ref={el => docInputRefs.current[hospitalId] = el}
                  type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="form-input-custom" style={{ padding: '10px 14px' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleDocUpload(hospitalId, file)
                    e.target.value = ''
                  }}
                />
                {docUploading === hospitalId && (
                  <div className="d-flex align-items-center gap-2 mt-2" style={{ fontSize: 12, color: 'var(--primary)' }}>
                    <div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    Uploading document...
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Website */}
        <div className="hospital-form-section">
          <div className="hospital-form-section-title">
            <i className="bi bi-globe" />Website
          </div>
          <div className="d-flex gap-2 align-items-end">
            <div style={{ flex: 1 }}>
              <input
                type="url" className="form-input-custom"
                placeholder="https://www.hospital-website.com"
                value={form.website_url || ''}
                onChange={e => onChange('website_url', e.target.value)}
              />
            </div>
            {form.website_url && (
              <a
                href={form.website_url.startsWith('http') ? form.website_url : `https://${form.website_url}`}
                target="_blank" rel="noopener noreferrer"
                className="hospital-website-link" style={{ height: 48, whiteSpace: 'nowrap' }}
              >
                <i className="bi bi-box-arrow-up-right" />Open
              </a>
            )}
          </div>
        </div>

        {/* Address & Location */}
        <div className="hospital-form-section">
          <div className="hospital-form-section-title">
            <i className="bi bi-geo-alt" />Address & Location
          </div>
          <div className="row g-3">
            <div className="col-12">
              <label className="form-label-custom">Street Address</label>
              <input
                type="text" className="form-input-custom" maxLength={300}
                placeholder="Full street address"
                value={form.address || ''}
                onChange={e => onChange('address', e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label-custom">City</label>
              <input
                type="text" className="form-input-custom" maxLength={100}
                placeholder="Mumbai"
                value={form.city || ''}
                onChange={e => onChange('city', e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label-custom">State</label>
              <input
                type="text" className="form-input-custom" maxLength={100}
                placeholder="Maharashtra"
                value={form.state || ''}
                onChange={e => onChange('state', e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label-custom">PIN Code</label>
              <input
                type="text" className="form-input-custom" maxLength={10}
                placeholder="400001"
                value={form.pincode || ''}
                onChange={e => onChange('pincode', e.target.value)}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label-custom">Latitude</label>
              <input
                type="number" className="form-input-custom" step="0.00000001"
                placeholder="19.07609" min={-90} max={90}
                value={form.latitude || ''}
                onChange={e => onChange('latitude', e.target.value)}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label-custom">Longitude</label>
              <input
                type="number" className="form-input-custom" step="0.00000001"
                placeholder="72.87741" min={-180} max={180}
                value={form.longitude || ''}
                onChange={e => onChange('longitude', e.target.value)}
              />
            </div>
            <div className="col-12">
              <HospitalLocationMap
                latitude={form.latitude}
                longitude={form.longitude}
                editable={true}
                onLocationChange={(lat, lng) => {
                  onChange('latitude', lat)
                  onChange('longitude', lng)
                }}
                hospitalName={form.hospital_name || 'Hospital'}
                hospitalAddress={[form.address, form.city, form.state].filter(Boolean).join(', ')}
                height="300px"
              />
            </div>
          </div>
        </div>
      </>
    )
  }

  if (loading) return <SkeletonProfilePage />

  return (
    <div>
      <div className="mb-4">
        <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
          My Profile
        </h4>
        <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
          Manage your personal and professional details
        </p>
      </div>

      <div className="row g-4">
        {/* Profile Card */}
        <div className="col-lg-4">
          <div className="card-custom card-static p-4 text-center" style={{ position: 'sticky', top: 88 }}>
            <div className="d-flex justify-content-center mb-3">
              <AvatarUpload
                currentUrl={personalForm.avatar_url}
                name={personalForm.name}
                size={110}
                onUpload={handleAvatarUpload}
                onRemove={handleAvatarRemove}
                uploading={uploading}
              />
            </div>
            <div className="profile-card-info">
              <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 4 }}>
                Dr. {personalForm.name || 'Doctor'}
              </h5>
            </div>
            <p style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 14, margin: '4px 0' }}>
              {profForm.specialization || 'Specialist'}
            </p>
            {profForm.qualification && (
              <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: '2px 0' }}>
                {profForm.qualification}
              </p>
            )}

            {/* Availability Status Badge */}
            <div className="mt-2 mb-1">
              <span className={`doctor-status-badge status-${profForm.availability_status.toLowerCase().replace('_', '-')}`}>
                <i className={`bi ${profForm.availability_status === 'AVAILABLE' ? 'bi-circle-fill' : profForm.availability_status === 'OFFLINE' ? 'bi-moon-fill' : profForm.availability_status === 'UNAVAILABLE' ? 'bi-dash-circle-fill' : 'bi-x-circle-fill'}`} style={{ fontSize: 8 }} />
                {profForm.availability_status === 'AVAILABLE' ? 'Available' : profForm.availability_status === 'OFFLINE' ? 'Offline' : profForm.availability_status === 'UNAVAILABLE' ? 'Unavailable' : 'Not in Service'}
              </span>
            </div>

            <hr className="divider" />

            <div className="d-flex flex-column gap-2 text-start profile-card-info">
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-envelope" style={{ color: 'var(--gray-400)', width: 20, flexShrink: 0 }} />
                <span className="profile-contact-text">{authProfile?.email ?? user?.email}</span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-telephone" style={{ color: 'var(--gray-400)', width: 20, flexShrink: 0 }} />
                <span className="profile-contact-text">{personalForm.phone || '—'}</span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-briefcase" style={{ color: 'var(--gray-400)', width: 20, flexShrink: 0 }} />
                <span className="profile-contact-text">{profForm.experience_years} years exp.</span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-currency-rupee" style={{ color: 'var(--gray-400)', width: 20, flexShrink: 0 }} />
                <span style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 600 }}>₹{profForm.consultation_fee}</span>
              </div>
              {profForm.registration_number && (
                <div className="d-flex align-items-center gap-2">
                  <i className="bi bi-card-text" style={{ color: 'var(--gray-400)', width: 20 }} />
                  <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>Reg: {profForm.registration_number}</span>
                </div>
              )}
            </div>

            {/* Languages */}
            {profForm.languages.length > 0 && (
              <>
                <hr className="divider" />
                <div className="text-start">
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Languages
                  </span>
                  <div className="d-flex flex-wrap gap-1 mt-2">
                    {profForm.languages.map(lang => (
                      <span key={lang} style={{
                        background: 'rgba(0,119,182,0.08)', color: 'var(--primary)',
                        padding: '2px 10px', borderRadius: 'var(--radius-full)',
                        fontSize: 12, fontWeight: 500
                      }}>
                        {lang}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Edit Area */}
        <div className="col-lg-8">
          <ProfileTabs
            tabs={['Personal', 'Professional', 'Hospitals', 'Affiliations', 'Security']}
            activeTab={activeTab}
            onChange={setActiveTab}
            icons={['bi-person', 'bi-briefcase-fill', 'bi-hospital', 'bi-link-45deg', 'bi-shield-lock']}
          />

          {/* Tab 1: Personal */}
          {activeTab === 0 && (
            <div className="card-custom p-4 mt-3 animate-fadeInUp">
              <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
                <i className="bi bi-person-lines-fill me-2 text-primary" />
                Personal Information
              </h6>
              <form onSubmit={handleSavePersonal}>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label-custom" htmlFor="doc-personal-name">Full Name *</label>
                    <input
                      id="doc-personal-name"
                      type="text"
                      className="form-input-custom"
                      value={personalForm.name}
                      onChange={e => setPersonalForm(prev => ({ ...prev, name: e.target.value }))}
                      required
                      maxLength={100}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label-custom" htmlFor="doc-personal-phone">Phone</label>
                    <input
                      id="doc-personal-phone"
                      type="tel"
                      className="form-input-custom"
                      placeholder="+91 98765 43210"
                      value={personalForm.phone}
                      onChange={e => setPersonalForm(prev => ({ ...prev, phone: e.target.value }))}
                      maxLength={15}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label-custom" htmlFor="doc-personal-bio">Bio / About</label>
                    <textarea
                      id="doc-personal-bio"
                      className="form-input-custom"
                      rows={4}
                      placeholder="Tell patients about yourself, your approach to care, and your experience..."
                      value={personalForm.bio}
                      onChange={e => setPersonalForm(prev => ({ ...prev, bio: e.target.value }))}
                      maxLength={500}
                    />
                    <div className={`char-counter ${personalForm.bio.length > 450 ? (personalForm.bio.length > 490 ? 'danger' : 'warning') : ''}`}>
                      {personalForm.bio.length}/500
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--gray-400)', display: 'block' }}>
                      This will be visible on your public profile
                    </span>
                  </div>
                </div>
                <div className="d-flex justify-content-end mt-4">
                  <button type="submit" className="btn-primary-custom" disabled={saving}>
                    {saving ? (
                      <><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> Saving...</>
                    ) : (
                      <><i className="bi bi-check-lg" /> Save Personal Info</>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tab 2: Professional */}
          {activeTab === 1 && (
            <div className="card-custom p-4 mt-3 animate-fadeInUp">
              <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
                <i className="bi bi-award me-2 text-primary" />
                Professional Details
              </h6>
              <form onSubmit={handleSaveProfessional}>
                {/* Status Selector */}
                <div className="doctor-status-selector mb-4">
                  <label className="form-label-custom">Availability Status</label>
                  <p style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 10 }}>
                    This status is visible to patients on your profile and search results
                  </p>
                  <div className="d-flex flex-wrap gap-2">
                    {[
                      { value: 'AVAILABLE', label: 'Available', icon: 'bi-circle-fill', color: 'var(--success)' },
                      { value: 'OFFLINE', label: 'Offline', icon: 'bi-moon-fill', color: 'var(--gray-400)' },
                      { value: 'UNAVAILABLE', label: 'Unavailable', icon: 'bi-dash-circle-fill', color: 'var(--warning)' },
                      { value: 'NOT_IN_SERVICE', label: 'Not in Service', icon: 'bi-x-circle-fill', color: 'var(--danger)' }
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`doctor-status-option ${profForm.availability_status === opt.value ? 'active' : ''}`}
                        style={{ '--status-color': opt.color }}
                        onClick={() => setProfForm(prev => ({ ...prev, availability_status: opt.value }))}
                      >
                        <i className={`bi ${opt.icon}`} style={{ color: opt.color, fontSize: 10 }} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label-custom">Specialization *</label>
                    <input
                      id="doc-prof-spec"
                      type="text"
                      className="form-input-custom"
                      value={profForm.specialization}
                      onChange={e => setProfForm(prev => ({ ...prev, specialization: e.target.value }))}
                      placeholder="e.g. Cardiology"
                      required
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label-custom">Qualification</label>
                    <input
                      id="doc-prof-qual"
                      type="text"
                      className="form-input-custom"
                      value={profForm.qualification}
                      onChange={e => setProfForm(prev => ({ ...prev, qualification: e.target.value }))}
                      placeholder="e.g. MBBS, MD, DM"
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label-custom">Experience (years)</label>
                    <input
                      id="doc-prof-exp"
                      type="number"
                      className="form-input-custom"
                      min={0}
                      value={profForm.experience_years}
                      onChange={e => setProfForm(prev => ({ ...prev, experience_years: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label-custom">Consultation Fee (₹)</label>
                    <input
                      id="doc-prof-fee"
                      type="number"
                      className="form-input-custom"
                      min={0}
                      value={profForm.consultation_fee}
                      onChange={e => setProfForm(prev => ({ ...prev, consultation_fee: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label-custom">Department</label>
                    <select
                      id="doc-prof-dept"
                      className="form-input-custom"
                      value={profForm.department_id}
                      onChange={e => setProfForm(prev => ({ ...prev, department_id: e.target.value }))}
                    >
                      <option value="">Select Department</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label-custom">Medical Registration No.</label>
                    <input
                      id="doc-prof-reg"
                      type="text"
                      className="form-input-custom"
                      placeholder="e.g. MCI-12345"
                      value={profForm.registration_number}
                      onChange={e => setProfForm(prev => ({ ...prev, registration_number: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label-custom">Languages Spoken</label>
                    <div className="d-flex gap-2">
                      <input
                        id="doc-prof-lang"
                        type="text"
                        className="form-input-custom"
                        placeholder="e.g. Hindi"
                        value={langInput}
                        onChange={e => setLangInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLanguage() } }}
                        style={{ flex: 1 }}
                      />
                      <button type="button" className="btn-ghost" onClick={addLanguage} style={{ whiteSpace: 'nowrap' }}>
                        <i className="bi bi-plus-lg" /> Add
                      </button>
                    </div>
                    {profForm.languages.length > 0 && (
                      <div className="d-flex flex-wrap gap-1 mt-2">
                        {profForm.languages.map(lang => (
                          <span key={lang} style={{
                            background: 'rgba(0,119,182,0.08)', color: 'var(--primary)',
                            padding: '3px 10px', borderRadius: 'var(--radius-full)',
                            fontSize: 13, fontWeight: 500, display: 'inline-flex',
                            alignItems: 'center', gap: 4
                          }}>
                            {lang}
                            <button
                              type="button"
                              onClick={() => removeLanguage(lang)}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--gray-400)', padding: 0, fontSize: 14, lineHeight: 1
                              }}
                            >
                              <i className="bi bi-x" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="d-flex justify-content-end mt-4">
                  <button type="submit" className="btn-primary-custom" disabled={saving}>
                    {saving ? (
                      <><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> Saving...</>
                    ) : (
                      <><i className="bi bi-check-lg" /> Save Professional Details</>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tab 3: Hospitals */}
          {activeTab === 2 && (
            <div className="card-custom p-4 mt-3 animate-fadeInUp">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0 }}>
                  <i className="bi bi-hospital me-2 text-primary" />
                  My Hospitals / Clinics
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--gray-400)', marginLeft: 8 }}>
                    ({hospitals.length}/{MAX_HOSPITALS_PER_DOCTOR})
                  </span>
                </h6>
                {hospitals.length < MAX_HOSPITALS_PER_DOCTOR && !showAddHospital && (
                  <button
                    type="button" className="btn-primary-custom"
                    style={{ fontSize: 13, padding: '8px 16px' }}
                    onClick={() => setShowAddHospital(true)}
                  >
                    <i className="bi bi-plus-lg me-1" />Add Hospital
                  </button>
                )}
              </div>

              {/* Add New Hospital Form */}
              {showAddHospital && (
                <div className="hospital-manage-card mb-3" style={{ border: '2px solid var(--primary)', borderRadius: 'var(--radius-lg, 16px)' }}>
                  <div className="hospital-manage-card-header" style={{ background: 'rgba(0,119,182,0.04)' }}>
                    <h6 style={{ color: 'var(--primary)' }}>
                      <i className="bi bi-plus-circle me-2" />Add New Hospital
                    </h6>
                    <button type="button" className="btn-ghost" style={{ fontSize: 13, color: 'var(--gray-500)' }}
                      onClick={() => { setShowAddHospital(false); setNewHospitalForm(getEmptyHospitalForm()) }}
                    >
                      <i className="bi bi-x-lg" />
                    </button>
                  </div>
                  <div className="hospital-manage-card-body">
                    {renderHospitalForm(
                      newHospitalForm,
                      (field, value) => setNewHospitalForm(prev => ({ ...prev, [field]: value }))
                    )}
                    <div className="d-flex justify-content-end gap-2 mt-3">
                      <button type="button" className="btn-outline-custom"
                        onClick={() => { setShowAddHospital(false); setNewHospitalForm(getEmptyHospitalForm()) }}
                      >
                        Cancel
                      </button>
                      <button type="button" className="btn-primary-custom"
                        onClick={handleAddHospital} disabled={hospitalSaving === 'new'}
                      >
                        {hospitalSaving === 'new' ? (
                          <><div className="spinner-custom" style={{ width: 16, height: 16, borderWidth: 2 }} /> Adding...</>
                        ) : (
                          <><i className="bi bi-plus-lg me-1" />Add Hospital</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Existing Hospitals */}
              {hospitals.length === 0 && !showAddHospital ? (
                <div className="hospital-tab-empty">
                  <i className="bi bi-hospital" />
                  <h5>No Hospitals Added Yet</h5>
                  <p>
                    Add your clinic or hospital information to help patients find you.
                    You can add up to {MAX_HOSPITALS_PER_DOCTOR} hospitals.
                  </p>
                  <button type="button" className="btn-primary-custom"
                    onClick={() => setShowAddHospital(true)}
                  >
                    <i className="bi bi-plus-lg me-1" />Add Your First Hospital
                  </button>
                </div>
              ) : (
                <div className="hospital-manage-list">
                  {hospitals.map(hospital => {
                    const isExpanded = expandedHospital === hospital.id
                    const form = editForms[hospital.id] || {}
                    const typeLabels = { PRIVATE: 'Private', GOVERNMENT: 'Government', CLINIC: 'Clinic', MULTI_SPECIALTY: 'Multi-Specialty' }

                    return (
                      <div key={hospital.id} className="hospital-manage-card">
                        <div
                          className="hospital-manage-card-header"
                          onClick={() => setExpandedHospital(isExpanded ? null : hospital.id)}
                        >
                          <h6>
                            <i className="bi bi-hospital" style={{ color: 'var(--primary)' }} />
                            {hospital.hospital_name}
                            {hospital.hospital_type && (
                              <span className="hospital-type-badge" style={{
                                background: 'rgba(0,119,182,0.08)', color: 'var(--primary)',
                                fontSize: 10, marginLeft: 8
                              }}>
                                {typeLabels[hospital.hospital_type] || hospital.hospital_type}
                              </span>
                            )}
                          </h6>
                          <div className="hospital-manage-card-actions">
                            <button type="button" className="btn-ghost" style={{ fontSize: 12, color: 'var(--danger)', padding: '4px 8px' }}
                              onClick={(e) => { e.stopPropagation(); handleDeleteHospital(hospital.id) }}
                            >
                              <i className="bi bi-trash" />
                            </button>
                            <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'}`}
                              style={{ color: 'var(--gray-400)', fontSize: 14 }}
                            />
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="hospital-manage-card-body">
                            {renderHospitalForm(
                              form,
                              (field, value) => updateEditForm(hospital.id, field, value),
                              hospital.id
                            )}
                            <div className="d-flex justify-content-end mt-3">
                              <button type="button" className="btn-primary-custom"
                                onClick={() => handleUpdateHospital(hospital.id)}
                                disabled={hospitalSaving === hospital.id}
                              >
                                {hospitalSaving === hospital.id ? (
                                  <><div className="spinner-custom" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving...</>
                                ) : (
                                  <><i className="bi bi-check-lg me-1" />Save Hospital Info</>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Hospital Affiliations */}
          {activeTab === 3 && (
            <div className="card-custom p-4 mt-3 animate-fadeInUp">
              <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                <div>
                  <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0 }}>
                    <i className="bi bi-link-45deg me-2 text-primary" />Hospital Affiliations
                  </h6>
                  <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: '4px 0 0' }}>
                    Join registered hospitals to appear in their directory.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary-custom"
                  style={{ fontSize: 13 }}
                  onClick={() => setShowJoinPanel(v => !v)}
                >
                  <i className={`bi ${showJoinPanel ? 'bi-x-lg' : 'bi-plus-lg'} me-1`} />
                  {showJoinPanel ? 'Cancel' : 'Join a Hospital'}
                </button>
              </div>

              {showJoinPanel && (
                <div className="mb-4" style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md, 10px)', padding: 16 }}>
                  <DoctorHospitalSelector
                    excludeIds={affiliations.map(a => a.hospital_id)}
                    joining={joiningId}
                    onSelect={handleJoinHospital}
                  />
                </div>
              )}

              {affiliations.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <i className="bi bi-hospital" style={{ fontSize: 40, color: 'var(--gray-300)' }} />
                  <p style={{ fontWeight: 600, color: 'var(--gray-500)', marginTop: 12 }}>
                    You haven't joined any hospitals yet
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>
                    Click "Join a Hospital" to affiliate with a registered hospital.
                  </p>
                </div>
              ) : (
                <div>
                  {affiliations.map(aff => {
                    const cover = getHospitalCoverUrl(aff.hospitals?.cover_photo_url)
                    return (
                      <div key={aff.id} className="doctor-affiliation-card">
                        <div className="doctor-affiliation-icon">
                          {cover ? <img src={cover} alt={aff.hospitals?.name} /> : <i className="bi bi-hospital" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="doctor-affiliation-name">
                            {aff.hospitals?.name ?? 'Hospital'}
                            {aff.is_primary && (
                              <span className="badge-confirmed" style={{ fontSize: 10, padding: '1px 8px', marginLeft: 8 }}>
                                <i className="bi bi-star-fill me-1" />Primary
                              </span>
                            )}
                          </div>
                          <div className="doctor-affiliation-meta">
                            {[aff.hospitals?.city, aff.hospitals?.state].filter(Boolean).join(', ') || '—'}
                          </div>
                        </div>
                        <div className="d-flex gap-2">
                          {!aff.is_primary && (
                            <button
                              type="button"
                              className="btn-ghost"
                              style={{ fontSize: 12, color: 'var(--primary)' }}
                              disabled={affActionId === aff.id}
                              onClick={() => handleSetPrimary(aff)}
                            >
                              <i className="bi bi-star me-1" />Set Primary
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ fontSize: 12, color: 'var(--danger)' }}
                            disabled={affActionId === aff.id}
                            onClick={() => handleLeaveHospital(aff)}
                          >
                            {affActionId === aff.id ? (
                              <div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} />
                            ) : (
                              <><i className="bi bi-box-arrow-left me-1" />Leave</>
                            )}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 5: Security */}
          {activeTab === 4 && (
            <div className="animate-fadeInUp">
              <div className="card-custom p-4 mt-3">
                <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
                  <i className="bi bi-key me-2 text-primary" />
                  Change Password
                </h6>
                <PasswordChange />
              </div>

              <div className="card-custom p-4 mt-3">
                <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
                  <i className="bi bi-info-circle me-2 text-primary" />
                  Account Information
                </h6>
                <div className="d-flex flex-column gap-3">
                  <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
                    <span style={{ color: 'var(--gray-500)' }}>Email</span>
                    <span style={{ fontWeight: 600 }}>{user?.email}</span>
                  </div>
                  <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
                    <span style={{ color: 'var(--gray-500)' }}>Role</span>
                    <span className="badge-confirmed" style={{ fontSize: 11 }}>Doctor</span>
                  </div>
                  <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
                    <span style={{ color: 'var(--gray-500)' }}>Status</span>
                    <span style={{ fontWeight: 600, color: 'var(--success)' }}>
                      <i className="bi bi-check-circle-fill me-1" />Active
                    </span>
                  </div>
                  <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
                    <span style={{ color: 'var(--gray-500)' }}>Joined</span>
                    <span style={{ fontWeight: 600 }}>
                      {authProfile?.created_at
                        ? new Date(authProfile.created_at).toLocaleDateString('en-US', {
                            month: 'long', day: 'numeric', year: 'numeric'
                          })
                        : '—'
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* Account Closure */}
              <AccountClosure role="DOCTOR" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
