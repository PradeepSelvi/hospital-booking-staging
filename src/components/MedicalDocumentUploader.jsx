import { useRef, useState } from 'react'
import { MEDICAL_DOC_CONSTRAINTS, DOC_CATEGORIES, validateMedicalFile, getDocumentUrl } from '../services/medicalHistory'
import { toast } from 'react-toastify'

/**
 * MedicalDocumentUploader — three sections (Sheets, Scans, Other).
 * Each section allows up to 3 files with size + format constraints.
 *
 * Props:
 * - grouped: { SHEET: [], SCAN: [], OTHER: [] }
 * - uploadingKey: category currently uploading (or null)
 * - onUpload: (category, file) => void
 * - onDelete: (docId) => void
 * - readOnly: hide upload/delete controls (doctor view)
 */
export default function MedicalDocumentUploader({
  grouped = { SHEET: [], SCAN: [], OTHER: [] },
  uploadingKey = null,
  onUpload,
  onDelete,
  onView,
  readOnly = false,
}) {
  return (
    <div className="med-doc-sections">
      {DOC_CATEGORIES.map(cat => (
        <Section
          key={cat.key}
          category={cat}
          files={grouped[cat.key] ?? []}
          uploading={uploadingKey === cat.key}
          onUpload={onUpload}
          onDelete={onDelete}
          onView={onView}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

function Section({ category, files, uploading, onUpload, onDelete, onView, readOnly }) {
  const fileRef = useRef(null)
  const atLimit = files.length >= MEDICAL_DOC_CONSTRAINTS.maxPerCategory

  function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const v = validateMedicalFile(file)
    if (!v.valid) {
      toast.error(v.error)
      return
    }
    onUpload?.(category.key, file)
  }

  async function handleView(doc) {
    try {
      // Notify parent (used by doctor views to log the access server-side).
      onView?.(doc)
      const url = await getDocumentUrl(doc.file_path)
      if (url) window.open(url, '_blank', 'noopener')
    } catch {
      toast.error('Could not open the file.')
    }
  }

  return (
    <div className="med-doc-section" style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
      <div className="d-flex align-items-center justify-content-between mb-1">
        <h6 style={{ margin: 0, fontWeight: 600 }}>
          <i className={`bi ${category.icon} me-2`} style={{ color: 'var(--primary)' }} />
          {category.label}
        </h6>
        <span style={{ fontSize: 12, color: atLimit ? '#D97706' : 'var(--gray-400)' }}>
          {files.length} / {MEDICAL_DOC_CONSTRAINTS.maxPerCategory}
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--gray-400)', margin: '0 0 12px' }}>{category.hint}</p>

      {files.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--gray-400)', fontStyle: 'italic', margin: '0 0 12px' }}>
          No files uploaded yet.
        </p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {files.map(doc => (
          <li key={doc.id} className="d-flex align-items-center gap-2 py-2"
              style={{ borderBottom: '1px solid var(--gray-100)' }}>
            <i className={`bi ${doc.mime_type === 'application/pdf' ? 'bi-file-earmark-pdf' : 'bi-file-earmark-image'}`}
               style={{ fontSize: 18, color: 'var(--gray-500)' }} />
            <button type="button" className="btn-ghost text-start" style={{ flex: 1, minWidth: 0, padding: 0, color: 'var(--gray-700)' }}
                    onClick={() => handleView(doc)} title="View file">
              <span className="truncate d-block" style={{ fontSize: 13 }}>{doc.file_name}</span>
              <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                {(doc.file_size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </button>
            {!readOnly && (
              <button type="button" className="btn-ghost text-danger" style={{ padding: '4px 8px' }}
                      onClick={() => onDelete?.(doc.id)} aria-label={`Delete ${doc.file_name}`}>
                <i className="bi bi-trash" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {!readOnly && (
        <>
          <button
            type="button"
            className="btn-ghost mt-3"
            style={{ fontSize: 13, color: 'var(--primary)', border: '1px dashed var(--gray-300)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', width: '100%' }}
            disabled={uploading || atLimit}
            onClick={() => fileRef.current?.click()}
          >
            {uploading
              ? <><span className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} /> Uploading...</>
              : atLimit
                ? 'Limit reached — delete a file to add another'
                : <><i className="bi bi-cloud-arrow-up me-1" />Upload file</>}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
          <p style={{ fontSize: 11, color: 'var(--gray-400)', margin: '8px 0 0', textAlign: 'center' }}>
            {MEDICAL_DOC_CONSTRAINTS.label} • Max {MEDICAL_DOC_CONSTRAINTS.maxSizeLabel}
          </p>
        </>
      )}
    </div>
  )
}
