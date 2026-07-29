import { useEffect, useRef } from 'react'

// Leaflet is loaded via CDN in index.html (window.L). This component plots
// multiple hospital markers for the admin report's geographic view.

const INDIA_CENTER = [20.5937, 78.9629]
const INDIA_ZOOM = 4

/**
 * ReportMap — plots hospital locations on an OpenStreetMap (Leaflet) map.
 *
 * @param {Array} points - [{ id, name, city, latitude, longitude }]
 * @param {string} height - CSS height (default '360px')
 */
export default function ReportMap({ points = [], height = '360px' }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (typeof window === 'undefined' || !window.L) return
    const L = window.L

    const map = L.map(containerRef.current, {
      center: INDIA_CENTER,
      zoom: INDIA_ZOOM,
      scrollWheelZoom: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // Re-plot markers when points change.
  useEffect(() => {
    const L = typeof window !== 'undefined' ? window.L : null
    if (!L || !mapRef.current || !layerRef.current) return

    layerRef.current.clearLayers()

    const markerIcon = L.divIcon({
      className: 'hospital-map-marker',
      html: `<div class="hospital-marker-pin"><i class="bi bi-hospital-fill"></i></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 34],
      popupAnchor: [0, -34],
    })

    const latlngs = []
    points.forEach(p => {
      const lat = parseFloat(p.latitude)
      const lng = parseFloat(p.longitude)
      if (Number.isNaN(lat) || Number.isNaN(lng)) return
      latlngs.push([lat, lng])
      const marker = L.marker([lat, lng], { icon: markerIcon })
      // Text content is set via textContent-safe template; names come from our
      // own DB (admin-managed), but we still avoid injecting raw HTML attributes.
      const name = String(p.name ?? 'Hospital')
      const city = String(p.city ?? '')
      const el = document.createElement('div')
      el.style.fontFamily = "'Inter', sans-serif"
      const strong = document.createElement('strong')
      strong.textContent = name
      el.appendChild(strong)
      if (city) {
        const br = document.createElement('br')
        const span = document.createElement('span')
        span.style.color = '#666'
        span.style.fontSize = '12px'
        span.textContent = city
        el.appendChild(br)
        el.appendChild(span)
      }
      marker.bindPopup(el)
      layerRef.current.addLayer(marker)
    })

    if (latlngs.length > 0) {
      try {
        mapRef.current.fitBounds(latlngs, { padding: [40, 40], maxZoom: 12 })
      } catch {
        mapRef.current.setView(INDIA_CENTER, INDIA_ZOOM)
      }
    } else {
      mapRef.current.setView(INDIA_CENTER, INDIA_ZOOM)
    }
  }, [points])

  if (typeof window !== 'undefined' && !window.L) {
    return (
      <div className="hospital-map-fallback" style={{ height }}>
        <i className="bi bi-geo-alt" style={{ fontSize: 32, color: 'var(--gray-300)' }} />
        <p style={{ fontSize: 13, color: 'var(--gray-400)', margin: '8px 0 0' }}>Map unavailable.</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="hospital-map-container"
      style={{ height, borderRadius: 12 }}
      role="img"
      aria-label={`Map showing ${points.length} hospital location${points.length !== 1 ? 's' : ''}`}
    />
  )
}
