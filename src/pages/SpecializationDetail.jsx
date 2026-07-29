import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getSpecializationBySlug, SPECIALIZATIONS } from '../data/specializations'
import { getDoctors } from '../services/doctors'
import { useAuth } from '../context/AuthContext'
import DoctorCard from '../components/DoctorCard'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { SkeletonDoctorCard } from '../components/SkeletonLoader'

export default function SpecializationDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const spec = getSpecializationBySlug(slug)

  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!spec) {
      navigate('/doctors', { replace: true })
      return
    }
    let active = true
    setLoading(true)
    getDoctors({ specialization: spec.name })
      .then(data => { if (active) setDoctors(data ?? []) })
      .catch(() => { if (active) setDoctors([]) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [slug])

  if (!spec) return null

  // Other specializations to suggest at the bottom
  const others = SPECIALIZATIONS.filter(s => s.slug !== spec.slug).slice(0, 4)

  return (
    <div>
      <Navbar />

      {/* Header */}
      <div className="page-header">
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <nav aria-label="breadcrumb" style={{ marginBottom: 16 }}>
            <Link to="/" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textDecoration: 'none' }}>Home</Link>
            <span style={{ color: 'rgba(255,255,255,0.4)', margin: '0 8px' }}>/</span>
            <span style={{ color: 'white', fontSize: 13 }}>{spec.name}</span>
          </nav>
          <div className="d-flex align-items-center gap-3">
            <div style={{
              width: 64, height: 64, borderRadius: 'var(--radius-lg)',
              background: 'rgba(255,255,255,0.12)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <i className={`bi ${spec.icon}`} style={{ fontSize: 30, color: 'white' }} />
            </div>
            <div>
              <h1 style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', color: 'white', fontFamily: 'var(--font-display)', margin: 0 }}>
                {spec.name}
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.75)', marginTop: 6, fontSize: 16, marginBottom: 0 }}>
                {spec.tagline}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container py-5">
        <div className="row g-4">
          {/* Left column — information */}
          <div className="col-lg-7">
            {/* Overview (basic) */}
            <div className="card-custom p-4 mb-4">
              <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 12 }}>
                <i className="bi bi-info-circle me-2 text-primary" />Overview
              </h5>
              <p style={{ color: 'var(--gray-600)', fontSize: 15, lineHeight: 1.8, margin: 0 }}>
                {spec.overview}
              </p>
            </div>

            {/* Advanced information */}
            <div className="card-custom p-4 mb-4">
              <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
                <i className="bi bi-stars me-2 text-primary" />Advanced Care & Treatments
              </h5>
              <ul className="list-unstyled d-flex flex-column gap-2" style={{ margin: 0 }}>
                {spec.advanced.map((item, i) => (
                  <li key={i} className="d-flex align-items-start gap-2" style={{ fontSize: 14, color: 'var(--gray-600)', lineHeight: 1.6 }}>
                    <i className="bi bi-check-circle-fill" style={{ color: 'var(--primary)', fontSize: 14, marginTop: 3, flexShrink: 0 }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Common conditions + Procedures */}
            <div className="row g-4 mb-4">
              <div className="col-md-6">
                <div className="card-custom p-4 h-100">
                  <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 14 }}>
                    <i className="bi bi-clipboard2-pulse me-2 text-primary" />Common Conditions
                  </h6>
                  <div className="d-flex flex-wrap gap-2">
                    {spec.commonConditions.map((c, i) => (
                      <span key={i} style={{
                        fontSize: 12.5, fontWeight: 600, padding: '5px 12px',
                        borderRadius: 'var(--radius-full)', background: 'rgba(0,119,182,0.08)',
                        color: 'var(--primary)'
                      }}>{c}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="card-custom p-4 h-100">
                  <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 14 }}>
                    <i className="bi bi-activity me-2 text-primary" />Tests & Procedures
                  </h6>
                  <ul className="list-unstyled d-flex flex-column gap-2" style={{ margin: 0 }}>
                    {spec.procedures.map((p, i) => (
                      <li key={i} style={{ fontSize: 13.5, color: 'var(--gray-600)' }}>
                        <i className="bi bi-dot" />{p}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* When to visit */}
            <div className="card-custom p-4 mb-4">
              <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
                <i className="bi bi-calendar-heart me-2 text-primary" />When to See a Specialist
              </h5>
              <ul className="list-unstyled d-flex flex-column gap-2" style={{ margin: 0 }}>
                {spec.whenToVisit.map((item, i) => (
                  <li key={i} className="d-flex align-items-start gap-2" style={{ fontSize: 14, color: 'var(--gray-600)', lineHeight: 1.6 }}>
                    <i className="bi bi-arrow-right-circle" style={{ color: 'var(--primary)', fontSize: 14, marginTop: 3, flexShrink: 0 }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* FAQ */}
            <div className="card-custom p-4">
              <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
                <i className="bi bi-question-circle me-2 text-primary" />Frequently Asked Questions
              </h5>
              <div className="d-flex flex-column gap-3">
                {spec.faqs.map((f, i) => (
                  <div key={i}>
                    <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--dark)', margin: '0 0 4px' }}>{f.q}</p>
                    <p style={{ fontSize: 14, color: 'var(--gray-600)', lineHeight: 1.7, margin: 0 }}>{f.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column — doctors / booking */}
          <div className="col-lg-5">
            <div className="position-sticky" style={{ top: 90 }}>
              <div className="card-custom p-4">
                <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 6 }}>
                  <i className="bi bi-person-badge me-2 text-primary" />
                  Book a {spec.name} Specialist
                </h5>
                <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 18 }}>
                  {loading
                    ? 'Loading available doctors...'
                    : doctors.length > 0
                      ? `${doctors.length} doctor${doctors.length !== 1 ? 's' : ''} available. Select one to choose a slot and book.`
                      : 'No doctors are currently listed for this specialization.'}
                </p>

                {!user && !loading && doctors.length > 0 && (
                  <div className="alert-custom alert-info mb-3" style={{ fontSize: 13 }}>
                    <i className="bi bi-info-circle" />
                    <span>
                      <Link to="/login" style={{ fontWeight: 700 }}>Log in</Link> to book an appointment.
                    </span>
                  </div>
                )}

                {loading ? (
                  <SkeletonDoctorCard count={2} />
                ) : doctors.length === 0 ? (
                  <div className="empty-state" style={{ padding: 24 }}>
                    <i className="bi bi-person-x" />
                    <p style={{ fontSize: 14 }}>No specialists available right now</p>
                    <Link to="/doctors" className="btn-outline-custom mt-2">Browse all doctors</Link>
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-3">
                    {doctors.map(doc => (
                      <DoctorCard key={doc.id} doctor={doc} />
                    ))}
                  </div>
                )}
              </div>

              {/* Disclaimer */}
              <p style={{ fontSize: 12, color: 'var(--gray-400)', lineHeight: 1.6, marginTop: 16 }}>
                <i className="bi bi-shield-exclamation me-1" />
                The information provided here is for general awareness only and is not a
                substitute for professional medical advice. Always consult a qualified doctor.
              </p>
            </div>
          </div>
        </div>

        {/* Other specializations */}
        <div className="mt-5">
          <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
            Explore Other Specializations
          </h5>
          <div className="row g-3">
            {others.map(o => (
              <div key={o.slug} className="col-6 col-md-3">
                <Link
                  to={`/specializations/${o.slug}`}
                  className="card-custom p-3 text-center h-100 d-block"
                  style={{ border: 'none', textDecoration: 'none' }}
                >
                  <div style={{
                    width: 48, height: 48, borderRadius: 'var(--radius-md)',
                    background: 'rgba(0,119,182,0.08)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px'
                  }}>
                    <i className={`bi ${o.icon}`} style={{ fontSize: 20, color: 'var(--primary)' }} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--dark)' }}>{o.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{o.desc}</div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
