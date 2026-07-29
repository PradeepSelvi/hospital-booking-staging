import { useRef, useState } from 'react'
import { getPhotoUrl, HOSPITAL_PHOTO_CONSTRAINTS } from '../services/hospital'

/**
 * HospitalPhotoManager — gallery management for a hospital profile.
 * Handles upload, caption editing, delete, and simple reordering.
 *
 * Props:
 * - photos: array of { id, photo_url, caption, display_order }
 * - uploading: boolean (an upload is in progress)
 * - onUpload: (file) => void
 * - onDelete: (photoId) => void
 * - onCaptionSave: (photoId, caption) => void
 * - onReorder: (orderedIds) => void
 */
export default function HospitalPhotoManager({
  photos = [],
  uploading = false,
  onUpload,
  onDelete,
  onCaptionSave,
  onReorder,
}) {
  const fileRef = useRef(null)
  const [captionDrafts, setCaptionDrafts] = useState({})
  const [dragIndex, setDragIndex] = useState(null)

  const atLimit = photos.length >= HOSPITAL_PHOTO_CONSTRAINTS.maxPhotos

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (file) onUpload?.(file)
    e.target.value = ''
  }

  function handleDrop(targetIndex) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      return
    }
    const reordered = [...photos]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    setDragIndex(null)
    onReorder?.(reordered.map(p => p.id))
  }

  return (
    <div className="hospital-gallery-manager">
      <div className="hospital-gallery-header">
        <span className="hospital-gallery-count">
          {photos.length} / {HOSPITAL_PHOTO_CONSTRAINTS.maxPhotos} photos
        </span>
        <button
          type="button"
          className="btn-primary-custom"
          disabled={uploading || atLimit}
          onClick={() => fileRef.current?.click()}
          style={{ fontSize: 13 }}
        >
          {uploading ? (
            <><div className="spinner-custom" style={{ width: 16, height: 16, borderWidth: 2 }} /> Uploading...</>
          ) : (
            <><i className="bi bi-cloud-arrow-up me-1" />Add Photo</>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          style={{ display: 'none' }}
          onChange={handleFile}
        />
      </div>

      {atLimit && (
        <p className="hospital-gallery-hint" style={{ color: '#D97706' }}>
          <i className="bi bi-info-circle me-1" />
          Maximum number of photos reached. Delete one to add another.
        </p>
      )}

      {photos.length === 0 ? (
        <div
          className="hospital-gallery-empty"
          role="button"
          tabIndex={0}
          onClick={() => !uploading && fileRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
        >
          <i className="bi bi-images" />
          <p>No photos yet. Click to upload your first photo.</p>
          <span>{HOSPITAL_PHOTO_CONSTRAINTS.label} • Max {HOSPITAL_PHOTO_CONSTRAINTS.maxSizeLabel}</span>
        </div>
      ) : (
        <div className="hospital-gallery-grid">
          {photos.map((photo, index) => {
            const url = getPhotoUrl(photo.photo_url)
            const draft = captionDrafts[photo.id] ?? photo.caption ?? ''
            return (
              <div
                key={photo.id}
                className={`hospital-gallery-card ${dragIndex === index ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(index)}
              >
                <div className="hospital-gallery-img-wrap">
                  <img src={url} alt={photo.caption || 'Hospital photo'} loading="lazy" />
                  <button
                    type="button"
                    className="hospital-gallery-delete"
                    aria-label="Delete photo"
                    onClick={() => onDelete?.(photo.id)}
                  >
                    <i className="bi bi-trash" />
                  </button>
                  <span className="hospital-gallery-order">
                    <i className="bi bi-grip-vertical" /> {index + 1}
                  </span>
                </div>
                <div className="hospital-gallery-caption-row">
                  <input
                    type="text"
                    className="form-input-custom"
                    placeholder="Add a caption..."
                    maxLength={120}
                    value={draft}
                    onChange={(e) => setCaptionDrafts(prev => ({ ...prev, [photo.id]: e.target.value }))}
                    style={{ fontSize: 12, padding: '6px 10px' }}
                  />
                  {draft !== (photo.caption ?? '') && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ fontSize: 12, padding: '6px 10px', color: 'var(--primary)' }}
                      onClick={() => onCaptionSave?.(photo.id, draft)}
                    >
                      <i className="bi bi-check-lg" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
