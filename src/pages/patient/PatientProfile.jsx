import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import {
  getProfile, updateProfile, getPatientDetails, updatePatientDetails,
  uploadAvatar, deleteAvatar, calculateCompleteness
} from '../../services/profiles'
import { getPatientAppointments } from '../../services/appointments'
import { toast } from 'react-toastify'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import AvatarUpload from '../../components/AvatarUpload'
import PasswordChange from '../../components/PasswordChange'
import ProfileTabs from '../../components/ProfileTabs'
import { SkeletonProfilePage } from '../../components/SkeletonLoader'
import { validateField, validatePhone, RULES } from '../../security/validators'
import { sanitizeFormData } from '../../security/sanitize'
import AIWriteAssistant from '../../components/AIWriteAssistant'
import AccountClosure from '../../components/AccountClosure'

export default function PatientProfile() {
  const { t, i18n } = useTranslation('patient')
  const { user, profile: authProfile, refreshProfile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activeTab, setActiveTab] = useState(0)

  // Profile data
  const [profileData, setProfileData] = useState({
    name: '', phone: '', bio: '', avatar_url: null,
    date_of_birth: '', gender: ''
  })

  // Patient-specific medical data
  const [medicalData, setMedicalData] = useState({
    blood_group: '', address: '', emergency_contact: '',
    dob: '', gender: ''
  })

  // Stats
  const [stats, setStats] = useState({ total: 0, upcoming: 0, completed: 0 })

  // Completeness
  const [completeness, setCompleteness] = useState(0)

  useEffect(() => {
    if (user) loadAllData()
  }, [user])

  async function loadAllData() {
    try {
      setLoading(true)
      const [profile, patientDetails, appointments] = await Promise.all([
        getProfile(user.id),
        getPatientDetails(user.id),
        getPatientAppointments(user.id)
      ])

      setProfileData({
        name: profile.name || '',
        phone: profile.phone || '',
        bio: profile.bio || '',
        avatar_url: profile.avatar_url || null,
        date_of_birth: profile.date_of_birth || '',
        gender: profile.gender || ''
      })

      if (patientDetails) {
        setMedicalData({
          blood_group: patientDetails.blood_group || '',
          address: patientDetails.address || '',
          emergency_contact: patientDetails.emergency_contact || '',
          dob: patientDetails.dob || '',
          gender: patientDetails.gender || ''
        })
      }

      // Calculate stats
      const today = new Date().toISOString().split('T')[0]
      const upcoming = appointments.filter(a =>
        ['PENDING', 'CONFIRMED'].includes(a.status) && a.appointment_date >= today
      )
      const completed = appointments.filter(a => a.status === 'COMPLETED')
      setStats({ total: appointments.length, upcoming: upcoming.length, completed: completed.length })

      // Completeness
      setCompleteness(calculateCompleteness(profile, patientDetails))
    } catch (err) {
      console.error('Failed to load profile data:', err)
      toast.error(t('profile.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSavePersonal(e) {
    e.preventDefault()
    // Validate fields
    const errs = {}
    const nameResult = validateField('name', profileData.name, { required: true })
    if (!nameResult.valid) errs.name = nameResult.message
    const phoneResult = validatePhone(profileData.phone)
    if (!phoneResult.valid) errs.phone = phoneResult.message
    const bioResult = validateField('bio', profileData.bio)
    if (!bioResult.valid) errs.bio = bioResult.message
    if (profileData.date_of_birth) {
      const dobResult = validateField('dateOfBirth', profileData.date_of_birth)
      if (!dobResult.valid) errs.dob = dobResult.message
    }
    if (Object.keys(errs).length > 0) {
      Object.values(errs).forEach(msg => toast.error(msg))
      return
    }
    try {
      setSaving(true)
      await updateProfile(user.id, {
        name: profileData.name.trim(),
        phone: profileData.phone.trim(),
        bio: profileData.bio.trim(),
        date_of_birth: profileData.date_of_birth || null,
        gender: profileData.gender || null
      })
      await refreshProfile()
      toast.success(t('profile.personalSaved'))
    } catch (err) {
      toast.error(t('profile.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveMedical(e) {
    e.preventDefault()
    // Validate emergency contact phone
    if (medicalData.emergency_contact) {
      const phoneResult = validatePhone(medicalData.emergency_contact)
      if (!phoneResult.valid) {
        toast.error(phoneResult.message)
        return
      }
    }
    try {
      setSaving(true)
      await updatePatientDetails(user.id, medicalData)
      toast.success(t('profile.medicalSaved'))
    } catch (err) {
      toast.error(t('profile.medicalSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarUpload(file) {
    try {
      setUploading(true)
      const url = await uploadAvatar(user.id, file)
      setProfileData(prev => ({ ...prev, avatar_url: url }))
      await refreshProfile()
      toast.success(t('profile.photoUpdated'))
    } catch (err) {
      toast.error(t('profile.photoUploadFailed', { error: err.message || t('profile.unknownError') }))
    } finally {
      setUploading(false)
    }
  }

  async function handleAvatarRemove() {
    try {
      setUploading(true)
      await deleteAvatar(user.id)
      setProfileData(prev => ({ ...prev, avatar_url: null }))
      await refreshProfile()
      toast.success(t('profile.photoRemoved'))
    } catch (err) {
      toast.error(t('profile.photoRemoveFailed'))
    } finally {
      setUploading(false)
    }
  }

  if (loading) return (
    <div>
      <Navbar />
      <div className="page-header"><div className="container"><div className="skeleton skeleton-heading" style={{ background: 'rgba(255,255,255,0.15)' }} /></div></div>
      <div className="container py-5"><SkeletonProfilePage /></div>
      <Footer />
    </div>
  )

  return (
    <div>
      <Navbar />

      {/* Page Header */}
      <div className="page-header">
        <div className="container">
          <div className="section-badge">{t('profile.badge')}</div>
          <h1 style={{
            fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', color: 'white',
            fontFamily: 'var(--font-display)', position: 'relative', zIndex: 1
          }}>
            {t('profile.title')}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: 6, fontSize: 15, position: 'relative', zIndex: 1 }}>
            {t('profile.subtitle')}
          </p>
        </div>
      </div>

      <div className="container py-5">
        <div className="row g-4">
          {/* ── Left Column: Profile Card ── */}
          <div className="col-lg-4">
            <div className="card-custom card-static p-4 text-center" style={{ position: 'sticky', top: 88 }}>
              {/* Avatar */}
              <div className="d-flex justify-content-center mb-3">
                <AvatarUpload
                  currentUrl={profileData.avatar_url}
                  name={profileData.name}
                  size={120}
                  onUpload={handleAvatarUpload}
                  onRemove={handleAvatarRemove}
                  uploading={uploading}
                />
              </div>

              <div className="profile-card-info">
                <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 4 }}>
                  {profileData.name || t('profile.patient')}
                </h5>
              </div>
              <span className="badge-confirmed" style={{ fontSize: 11 }}>{t('profile.patient')}</span>

              <hr className="divider" />

              {/* Contact Info */}
              <div className="d-flex flex-column gap-2 text-start profile-card-info">
                <div className="d-flex align-items-center gap-2">
                  <i className="bi bi-envelope" style={{ color: 'var(--gray-400)', width: 20, flexShrink: 0 }} />
                  <span className="profile-contact-text">{user?.email}</span>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <i className="bi bi-telephone" style={{ color: 'var(--gray-400)', width: 20, flexShrink: 0 }} />
                  <span className="profile-contact-text">{profileData.phone || '—'}</span>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <i className="bi bi-calendar3" style={{ color: 'var(--gray-400)', width: 20, flexShrink: 0 }} />
                  <span className="profile-contact-text">
                    {authProfile?.created_at
                      ? t('profile.joined', { date: new Date(authProfile.created_at).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' }) })
                      : '—'
                    }
                  </span>
                </div>
              </div>

              <hr className="divider" />

              {/* Completeness */}
              <div className="mb-3">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-600)' }}>{t('profile.profileComplete')}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: completeness === 100 ? 'var(--success)' : 'var(--primary)' }}>
                    {completeness}%
                  </span>
                </div>
                <div className="profile-completeness-bar">
                  <div
                    className="profile-completeness-fill"
                    style={{
                      width: `${completeness}%`,
                      background: completeness === 100
                        ? 'var(--success)'
                        : 'linear-gradient(90deg, var(--primary), var(--primary-light))'
                    }}
                  />
                </div>
              </div>

              {/* Quick Stats */}
              <div className="d-flex gap-2 mt-3">
                {[
                  { value: stats.total, label: t('profile.statTotal'), color: 'var(--primary)' },
                  { value: stats.upcoming, label: t('profile.statUpcoming'), color: 'var(--warning)' },
                  { value: stats.completed, label: t('profile.statDone'), color: 'var(--success)' }
                ].map((s, i) => (
                  <div key={i} className="profile-stat">
                    <div className="profile-stat-value" style={{ color: s.color }}>{s.value}</div>
                    <div className="profile-stat-label">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right Column: Tabbed Content ── */}
          <div className="col-lg-8">
            <ProfileTabs
              tabs={[t('profile.tabPersonal'), t('profile.tabMedical'), t('profile.tabSecurity')]}
              activeTab={activeTab}
              onChange={setActiveTab}
              icons={['bi-person', 'bi-heart-pulse', 'bi-shield-lock']}
            />

            {/* Tab 1: Personal Information */}
            {activeTab === 0 && (
              <div className="card-custom p-4 mt-3 animate-fadeInUp">
                <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
                  <i className="bi bi-person-lines-fill me-2 text-primary" />
                  {t('profile.personalInfo')}
                </h6>
                <form onSubmit={handleSavePersonal}>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label-custom" htmlFor="profile-name">{t('profile.fullName')}</label>
                      <input
                        id="profile-name"
                        type="text"
                        className="form-input-custom"
                        placeholder={t('profile.fullNamePlaceholder')}
                        value={profileData.name}
                        onChange={e => setProfileData(prev => ({ ...prev, name: e.target.value }))}
                        required
                        maxLength={100}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label-custom" htmlFor="profile-phone">{t('profile.phoneNumber')}</label>
                      <input
                        id="profile-phone"
                        type="tel"
                        className="form-input-custom"
                        placeholder={t('profile.phonePlaceholder')}
                        value={profileData.phone}
                        onChange={e => setProfileData(prev => ({ ...prev, phone: e.target.value }))}
                        maxLength={15}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label-custom">{t('profile.dateOfBirth')}</label>
                      <input
                        id="profile-dob"
                        type="date"
                        className="form-input-custom"
                        value={profileData.date_of_birth}
                        onChange={e => setProfileData(prev => ({ ...prev, date_of_birth: e.target.value }))}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label-custom">{t('profile.gender')}</label>
                      <select
                        id="profile-gender"
                        className="form-input-custom"
                        value={profileData.gender}
                        onChange={e => setProfileData(prev => ({ ...prev, gender: e.target.value }))}
                      >
                        <option value="">{t('profile.selectGender')}</option>
                        <option value="MALE">{t('profile.male')}</option>
                        <option value="FEMALE">{t('profile.female')}</option>
                        <option value="OTHER">{t('profile.other')}</option>
                      </select>
                    </div>
                    <div className="col-12">
                      <div className="d-flex align-items-center justify-content-between mb-1">
                        <label className="form-label-custom mb-0" htmlFor="profile-bio">{t('profile.aboutMe')}</label>
                        <AIWriteAssistant
                          fieldName="bio"
                          currentValue={profileData.bio}
                          context={{ name: profileData.name, role: 'patient' }}
                          onGenerated={(text) => setProfileData(prev => ({ ...prev, bio: text }))}
                          placeholder={t('profile.aiBioPlaceholder')}
                        />
                      </div>
                      <textarea
                        id="profile-bio"
                        className="form-input-custom"
                        rows={3}
                        placeholder={t('profile.bioPlaceholder')}
                        value={profileData.bio}
                        onChange={e => setProfileData(prev => ({ ...prev, bio: e.target.value }))}
                        maxLength={500}
                      />
                      <div className={`char-counter ${profileData.bio.length > 450 ? (profileData.bio.length > 490 ? 'danger' : 'warning') : ''}`}>
                        {profileData.bio.length}/500
                      </div>
                    </div>
                  </div>

                  <div className="d-flex justify-content-between align-items-center mt-4">
                    <span style={{ fontSize: 13, color: 'var(--gray-400)' }}>
                      <i className="bi bi-info-circle me-1" />
                      {t('profile.emailCannotChange')}
                    </span>
                    <button type="submit" className="btn-primary-custom" disabled={saving}>
                      {saving ? (
                        <><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> {t('profile.saving')}</>
                      ) : (
                        <><i className="bi bi-check-lg" /> {t('profile.saveChanges')}</>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Tab 2: Medical Information */}
            {activeTab === 1 && (
              <div className="card-custom p-4 mt-3 animate-fadeInUp">
                <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 8 }}>
                  <i className="bi bi-heart-pulse me-2 text-primary" />
                  {t('profile.medicalInfo')}
                </h6>
                <p style={{ fontSize: 13, color: 'var(--gray-400)', marginBottom: 20 }}>
                  {t('profile.medicalInfoHint')}
                </p>

                <form onSubmit={handleSaveMedical}>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label-custom">{t('profile.bloodGroup')}</label>
                      <select
                        id="medical-blood-group"
                        className="form-input-custom"
                        value={medicalData.blood_group}
                        onChange={e => setMedicalData(prev => ({ ...prev, blood_group: e.target.value }))}
                      >
                        <option value="">{t('profile.selectBloodGroup')}</option>
                        {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                          <option key={bg} value={bg}>{bg}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label-custom" htmlFor="medical-emergency">{t('profile.emergencyContact')}</label>
                      <input
                        id="medical-emergency"
                        type="tel"
                        className="form-input-custom"
                        placeholder={t('profile.emergencyPlaceholder')}
                        value={medicalData.emergency_contact}
                        onChange={e => setMedicalData(prev => ({ ...prev, emergency_contact: e.target.value }))}
                        maxLength={15}
                      />
                    </div>
                    <div className="col-12">
                      <div className="d-flex align-items-center justify-content-between mb-1">
                        <label className="form-label-custom mb-0" htmlFor="medical-address">{t('profile.address')}</label>
                        <AIWriteAssistant
                          fieldName="address"
                          currentValue={medicalData.address}
                          context={{ name: profileData.name, role: 'patient' }}
                          onGenerated={(text) => setMedicalData(prev => ({ ...prev, address: text }))}
                          placeholder={t('profile.aiAddressPlaceholder')}
                        />
                      </div>
                      <textarea
                        id="medical-address"
                        className="form-input-custom"
                        rows={3}
                        placeholder={t('profile.addressPlaceholder')}
                        value={medicalData.address}
                        onChange={e => setMedicalData(prev => ({ ...prev, address: e.target.value }))}
                        maxLength={500}
                      />
                      <div className={`char-counter ${(medicalData.address?.length || 0) > 450 ? ((medicalData.address?.length || 0) > 490 ? 'danger' : 'warning') : ''}`}>
                        {medicalData.address?.length || 0}/500
                      </div>
                    </div>
                  </div>

                  <button type="submit" className="btn-primary-custom mt-4" disabled={saving}>
                    {saving ? (
                      <><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> {t('profile.saving')}</>
                    ) : (
                      <><i className="bi bi-check-lg" /> {t('profile.saveMedicalInfo')}</>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* Tab 3: Security */}
            {activeTab === 2 && (
              <div className="animate-fadeInUp">
                {/* Password Change */}
                <div className="card-custom p-4 mt-3">
                  <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
                    <i className="bi bi-key me-2 text-primary" />
                    {t('profile.changePassword')}
                  </h6>
                  <PasswordChange />
                </div>

                {/* Account Info */}
                <div className="card-custom p-4 mt-3">
                  <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
                    <i className="bi bi-info-circle me-2 text-primary" />
                    {t('profile.accountInfo')}
                  </h6>
                  <div className="d-flex flex-column gap-3">
                    <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
                      <span style={{ color: 'var(--gray-500)' }}>{t('profile.email')}</span>
                      <span style={{ fontWeight: 600 }}>{user?.email}</span>
                    </div>
                    <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
                      <span style={{ color: 'var(--gray-500)' }}>{t('profile.role')}</span>
                      <span className="badge-confirmed" style={{ fontSize: 11 }}>{t('profile.patient')}</span>
                    </div>
                    <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
                      <span style={{ color: 'var(--gray-500)' }}>{t('profile.accountStatus')}</span>
                      <span style={{ fontWeight: 600, color: 'var(--success)' }}>
                        <i className="bi bi-check-circle-fill me-1" />{t('profile.active')}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
                      <span style={{ color: 'var(--gray-500)' }}>{t('profile.memberSince')}</span>
                      <span style={{ fontWeight: 600 }}>
                        {authProfile?.created_at
                          ? new Date(authProfile.created_at).toLocaleDateString(i18n.language, {
                              month: 'long', day: 'numeric', year: 'numeric'
                            })
                          : '—'
                        }
                      </span>
                    </div>
                  </div>
                </div>

                {/* Danger Zone — Account Closure */}
                <AccountClosure role="PATIENT" />
              </div>
            )}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
