import { useState, useRef } from 'react'

/**
 * Reusable avatar upload component with hover overlay, file picker,
 * and loading state. Used across Patient, Doctor, and Admin profile pages.
 *
 * Props:
 * - currentUrl: string | null — current avatar URL
 * - name: string — user's display name (for initials fallback)
 * - size: number — avatar diameter in px (default 120)
 * - onUpload: (file: File) => Promise<void> — called when user selects a file
 * - onRemove: () => Promise<void> — called when user clicks remove
 * - uploading: boolean — shows spinner during upload
 * - editable: boolean — enables hover overlay (default true)
 */
export default function AvatarUpload({
  currentUrl,
  name = '',
  size = 120,
  onUpload,
  onRemove,
  uploading = false,
  editable = true
}) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'

  function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPEG, PNG, or WebP)')
      return
    }

    // Validate file size (max 5MB before compression)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be under 5MB')
      return
    }

    onUpload?.(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file && file.type.startsWith('image/')) {
      onUpload?.(file)
    }
  }

  return (
    <div className="profile-avatar-wrapper" style={{ width: size, height: size }}>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        id="avatar-file-input"
      />

      {/* Avatar circle */}
      <div
        className={`profile-avatar-circle ${dragOver ? 'drag-over' : ''}`}
        style={{ width: size, height: size, fontSize: size * 0.35 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => editable && !uploading && inputRef.current?.click()}
      >
        {currentUrl ? (
          <img
            src={currentUrl}
            alt={name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '50%'
            }}
          />
        ) : (
          <span className="avatar-initials">{initials}</span>
        )}

        {/* Hover overlay */}
        {editable && !uploading && (
          <div className="profile-avatar-overlay">
            <i className="bi bi-camera-fill" style={{ fontSize: size * 0.2 }} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              {currentUrl ? 'Change' : 'Upload'}
            </span>
          </div>
        )}

        {/* Uploading spinner */}
        {uploading && (
          <div className="profile-avatar-overlay" style={{ opacity: 1 }}>
            <div
              className="spinner-custom"
              style={{ width: size * 0.25, height: size * 0.25, borderWidth: 2 }}
            />
          </div>
        )}
      </div>

      {/* Remove button */}
      {currentUrl && editable && !uploading && (
        <button
          className="profile-avatar-remove"
          onClick={(e) => { e.stopPropagation(); onRemove?.() }}
          title="Remove photo"
          type="button"
        >
          <i className="bi bi-trash3" />
        </button>
      )}
    </div>
  )
}
