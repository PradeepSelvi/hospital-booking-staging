import { useState } from 'react'

/**
 * HospitalPhotoGallery — Displays 1-2 hospital photos with lightbox.
 * 
 * @param {Object} props
 * @param {string|null} props.photo1Url - Public URL for photo 1
 * @param {string|null} props.photo2Url - Public URL for photo 2
 * @param {string} props.hospitalName - Hospital name for alt text
 */
export default function HospitalPhotoGallery({ photo1Url, photo2Url, hospitalName = 'Hospital' }) {
  const [lightboxImg, setLightboxImg] = useState(null)

  const photos = [photo1Url, photo2Url].filter(Boolean)

  if (photos.length === 0) return null

  return (
    <>
      <div className={`hospital-photo-grid hospital-photo-grid-${photos.length}`}>
        {photos.map((url, i) => (
          <div
            key={i}
            className="hospital-photo-item"
            onClick={() => setLightboxImg(url)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setLightboxImg(url)}
          >
            <img
              src={url}
              alt={`${hospitalName} - Photo ${i + 1}`}
              className="hospital-photo-img"
              loading="lazy"
            />
            <div className="hospital-photo-overlay">
              <i className="bi bi-arrows-fullscreen" />
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxImg && (
        <div
          className="hospital-lightbox-overlay"
          onClick={() => setLightboxImg(null)}
        >
          <div
            className="hospital-lightbox-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="hospital-lightbox-close"
              onClick={() => setLightboxImg(null)}
              aria-label="Close photo viewer"
            >
              <i className="bi bi-x-lg" />
            </button>
            <img
              src={lightboxImg}
              alt={`${hospitalName} — Full Size`}
              className="hospital-lightbox-img"
            />
            <div className="hospital-lightbox-caption">
              <i className="bi bi-hospital me-2" />
              {hospitalName}
            </div>

            {/* Navigation dots if 2 photos */}
            {photos.length === 2 && (
              <div className="hospital-lightbox-nav">
                {photos.map((url, i) => (
                  <button
                    key={i}
                    className={`hospital-lightbox-dot ${lightboxImg === url ? 'active' : ''}`}
                    onClick={() => setLightboxImg(url)}
                    aria-label={`View photo ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
