import { useEffect, useRef, useState, useCallback } from 'react'

// ─────────────────────────────────────────────
// Leaflet is loaded via CDN in index.html to avoid
// bundling issues. This component uses the global L object.
// ─────────────────────────────────────────────

const DEFAULT_CENTER = [20.5937, 78.9629] // India center
const DEFAULT_ZOOM = 5
const LOCATION_ZOOM = 15

/**
 * HospitalLocationMap - Interactive map using Leaflet + OpenStreetMap
 * 
 * @param {Object} props
 * @param {number|null} props.latitude - Current latitude
 * @param {number|null} props.longitude - Current longitude
 * @param {boolean} props.editable - If true, allows picking location on map
 * @param {function} props.onLocationChange - Callback when location changes (editable mode)
 * @param {string} props.hospitalName - Name to show in popup (view mode)
 * @param {string} props.hospitalAddress - Address to show in popup
 * @param {string} props.height - Map container height (default: '300px')
 */
export default function HospitalLocationMap({
  latitude,
  longitude,
  editable = false,
  onLocationChange,
  hospitalName = 'Hospital',
  hospitalAddress = '',
  height = '300px',
}) {
  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [locating, setLocating] = useState(false)

  // Check if Leaflet is available
  const isLeafletAvailable = useCallback(() => {
    return typeof window !== 'undefined' && window.L
  }, [])

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || !isLeafletAvailable()) return
    if (mapInstanceRef.current) return // Already initialized

    const L = window.L

    const center = latitude && longitude
      ? [parseFloat(latitude), parseFloat(longitude)]
      : DEFAULT_CENTER

    const zoom = latitude && longitude ? LOCATION_ZOOM : DEFAULT_ZOOM

    const map = L.map(mapContainerRef.current, {
      center,
      zoom,
      scrollWheelZoom: !editable, // Disable scroll zoom in edit mode to prevent page scroll issues
      zoomControl: true,
      attributionControl: true,
    })

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    // Custom marker icon
    const markerIcon = L.divIcon({
      className: 'hospital-map-marker',
      html: `<div class="hospital-marker-pin"><i class="bi bi-hospital-fill"></i></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -42],
    })

    // Add marker if we have coordinates
    if (latitude && longitude) {
      const marker = L.marker(center, {
        icon: markerIcon,
        draggable: editable,
      }).addTo(map)

      // Popup
      const popupContent = `
        <div style="font-family: 'Inter', sans-serif; min-width: 150px;">
          <strong style="font-size: 14px; color: #1a1a2e;">${hospitalName}</strong>
          ${hospitalAddress ? `<br><span style="font-size: 12px; color: #666;">${hospitalAddress}</span>` : ''}
        </div>
      `
      marker.bindPopup(popupContent)

      if (!editable) {
        marker.openPopup()
      }

      // Drag event for editable mode
      if (editable) {
        marker.on('dragend', (e) => {
          const pos = e.target.getLatLng()
          onLocationChange?.(pos.lat.toFixed(8), pos.lng.toFixed(8))
        })
      }

      markerRef.current = marker
    }

    // Click to place marker in editable mode
    if (editable) {
      map.on('click', (e) => {
        const { lat, lng } = e.latlng

        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng])
        } else {
          const marker = L.marker([lat, lng], {
            icon: markerIcon,
            draggable: true,
          }).addTo(map)

          marker.on('dragend', (ev) => {
            const pos = ev.target.getLatLng()
            onLocationChange?.(pos.lat.toFixed(8), pos.lng.toFixed(8))
          })

          markerRef.current = marker
        }

        onLocationChange?.(lat.toFixed(8), lng.toFixed(8))
      })
    }

    mapInstanceRef.current = map
    setMapReady(true)

    // Cleanup
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
        markerRef.current = null
        setMapReady(false)
      }
    }
  }, []) // Only run once on mount

  // Update marker position when lat/lng changes externally
  useEffect(() => {
    if (!mapInstanceRef.current || !isLeafletAvailable()) return

    const L = window.L
    const lat = parseFloat(latitude)
    const lng = parseFloat(longitude)

    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      const markerIcon = L.divIcon({
        className: 'hospital-map-marker',
        html: `<div class="hospital-marker-pin"><i class="bi bi-hospital-fill"></i></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -42],
      })

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng])
      } else {
        const marker = L.marker([lat, lng], {
          icon: markerIcon,
          draggable: editable,
        }).addTo(mapInstanceRef.current)

        if (editable) {
          marker.on('dragend', (e) => {
            const pos = e.target.getLatLng()
            onLocationChange?.(pos.lat.toFixed(8), pos.lng.toFixed(8))
          })
        }

        markerRef.current = marker
      }

      mapInstanceRef.current.setView([lat, lng], LOCATION_ZOOM, { animate: true })
    }
  }, [latitude, longitude])

  // Use browser geolocation
  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(8)
        const lng = position.coords.longitude.toFixed(8)
        onLocationChange?.(lat, lng)
        setLocating(false)
      },
      (error) => {
        console.error('Geolocation error:', error)
        alert('Unable to get your location. Please allow location access and try again.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // Leaflet not loaded fallback
  if (!isLeafletAvailable()) {
    return (
      <div className="hospital-map-fallback" style={{ height }}>
        <i className="bi bi-geo-alt" style={{ fontSize: 32, color: 'var(--gray-300)' }} />
        <p style={{ fontSize: 13, color: 'var(--gray-400)', margin: '8px 0 0' }}>
          Map loading... If this persists, check that Leaflet is included.
        </p>
      </div>
    )
  }

  return (
    <div className="hospital-map-wrapper">
      {editable && (
        <div className="hospital-map-toolbar">
          <button
            type="button"
            className="btn-ghost hospital-map-locate-btn"
            onClick={handleUseMyLocation}
            disabled={locating}
          >
            {locating ? (
              <>
                <div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} />
                Locating...
              </>
            ) : (
              <>
                <i className="bi bi-crosshair me-1" />
                Use My Location
              </>
            )}
          </button>
          <span className="hospital-map-hint">
            <i className="bi bi-info-circle me-1" />
            Click on the map or drag the pin to set location
          </span>
        </div>
      )}
      <div
        ref={mapContainerRef}
        className="hospital-map-container"
        style={{ height, borderRadius: editable ? '0 0 12px 12px' : '12px' }}
      />
    </div>
  )
}
