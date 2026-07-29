import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import {
  getMedicalHistory, upsertMedicalHistory,
  getMedicalDocuments, groupByCategory,
  uploadMedicalDocument, deleteMedicalDocument,
} from '../../services/medicalHistory'
import MedicalDocumentUploader from '../../components/MedicalDocumentUploader'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import { toast } from 'react-toastify'

const EMPTY = {
  medical_summary: '', previous_concerns: '', current_medications: '',
  allergies: '', chronic_conditions: '', other_info: '',
}

export default function MedicalHistory() {
  const { t } = useTranslation('patient')
  const { user } = useAuth()

  const TEXT_FIELDS = [
    { key: 'medical_summary', label: t('medicalHistory.fieldMedicalSummary'), placeholder: t('medicalHistory.phMedicalSummary') },
    { key: 'previous_concerns', label: t('medicalHistory.fieldPreviousConcerns'), placeholder: t('medicalHistory.phPreviousConcerns') },
    { key: 'current_medications', label: t('medicalHistory.fieldCurrentMedications'), placeholder: t('medicalHistory.phCurrentMedications') },
    { key: 'allergies', label: t('medicalHistory.fieldAllergies'), placeholder: t('medicalHistory.phAllergies') },
    { key: 'chronic_conditions', label: t('medicalHistory.fieldChronicConditions'), placeholder: t('medicalHistory.phChronicConditions') },
    { key: 'other_info', label: t('medicalHistory.fieldOtherInfo'), placeholder: t('medicalHistory.phOtherInfo') },
  ]

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fields, setFields] = useState(EMPTY)
  const [grouped, setGrouped] = useState({ SHEET: [], SCAN: [], OTHER: [] })
  const [uploadingKey, setUploadingKey] = useState(null)

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData() {
    try {
      setLoading(true)
      const [history, docs] = await Promise.all([
        getMedicalHistory(user.id),
        getMedicalDocuments(user.id),
      ])
      if (history) {
        setFields({ ...EMPTY, ...Object.fromEntries(
          Object.keys(EMPTY).map(k => [k, history[k] ?? ''])
        ) })
      }
      setGrouped(groupByCategory(docs))
    } catch (err) {
      toast.error(err.message || t('medicalHistory.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    try {
      setSaving(true)
      await upsertMedicalHistory(user.id, fields)
      toast.success(t('medicalHistory.saved'))
    } catch (err) {
      toast.error(err.message || t('medicalHistory.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload(category, file) {
    try {
      setUploadingKey(category)
      await uploadMedicalDocument(user.id, category, file)
      const docs = await getMedicalDocuments(user.id)
      setGrouped(groupByCategory(docs))
      toast.success(t('medicalHistory.fileUploaded'))
    } catch (err) {
      toast.error(err.message || t('medicalHistory.uploadFailed'))
    } finally {
      setUploadingKey(null)
    }
  }

  async function handleDelete(docId) {
    try {
      await deleteMedicalDocument(docId)
      const docs = await getMedicalDocuments(user.id)
      setGrouped(groupByCategory(docs))
      toast.success(t('medicalHistory.fileDeleted'))
    } catch (err) {
      toast.error(err.message || t('medicalHistory.deleteFailed'))
    }
  }

  return (
    <>
      <Navbar />
      <div className="container" style={{ maxWidth: 880, padding: '32px 16px 64px' }}>
        <div className="mb-4">
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>{t('medicalHistory.title')}</h1>
          <p style={{ color: 'var(--gray-500)', margin: '6px 0 0' }}>
            {t('medicalHistory.subtitle')}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-custom" />
          </div>
        ) : (
          <>
            {/* ── Text fields ── */}
            <form onSubmit={handleSave} className="card-custom" style={{ padding: 24, marginBottom: 24 }}>
              <h5 style={{ fontWeight: 600, marginBottom: 16 }}>{t('medicalHistory.healthSummary')}</h5>
              {TEXT_FIELDS.map(f => (
                <div key={f.key} className="mb-3">
                  <label className="form-label-custom">{f.label}</label>
                  <textarea
                    className="form-input-custom"
                    rows={3}
                    maxLength={2000}
                    placeholder={f.placeholder}
                    value={fields[f.key]}
                    onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <button type="submit" className="btn-primary-custom" disabled={saving}>
                {saving ? t('medicalHistory.saving') : t('medicalHistory.saveSummary')}
              </button>
            </form>

            {/* ── Documents ── */}
            <div className="card-custom" style={{ padding: 24 }}>
              <h5 style={{ fontWeight: 600, marginBottom: 4 }}>{t('medicalHistory.documents')}</h5>
              <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 16 }}>
                {t('medicalHistory.documentsHint')}
              </p>
              <MedicalDocumentUploader
                grouped={grouped}
                uploadingKey={uploadingKey}
                onUpload={handleUpload}
                onDelete={handleDelete}
              />
            </div>
          </>
        )}
      </div>
      <Footer />
    </>
  )
}
