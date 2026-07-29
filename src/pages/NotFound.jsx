import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--dark) 0%, #0A2A6E 40%, var(--primary) 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Decorative circles */}
      <div style={{
        position: 'absolute', width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,180,216,0.12) 0%, transparent 70%)',
        top: -150, right: -100
      }} />
      <div style={{
        position: 'absolute', width: 350, height: 350, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,119,182,0.15) 0%, transparent 70%)',
        bottom: -100, left: -50
      }} />

      <div className="text-center" style={{ position: 'relative', zIndex: 2 }}>
        <div style={{
          fontSize: 'clamp(6rem, 15vw, 10rem)',
          fontWeight: 900,
          fontFamily: 'var(--font-display)',
          color: 'rgba(255,255,255,0.08)',
          lineHeight: 1,
          marginBottom: -40
        }}>
          404
        </div>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'rgba(239,35,60,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px'
        }}>
          <i className="bi bi-exclamation-triangle" style={{ fontSize: 32, color: '#EF233C' }} />
        </div>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          color: 'white',
          fontSize: 'clamp(1.5rem, 3vw, 2rem)',
          marginBottom: 12
        }}>
          Page Not Found
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, maxWidth: 400, margin: '0 auto 32px' }}>
          The page you're looking for doesn't exist or has been moved. Let's get you back on track.
        </p>
        <div className="d-flex gap-3 justify-content-center">
          <Link
            to="/"
            className="btn-primary-custom"
            style={{ background: 'white', color: 'var(--primary)', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}
          >
            <i className="bi bi-house" /> Go Home
          </Link>
          <Link
            to="/doctors"
            className="btn-outline-custom"
            style={{ borderColor: 'rgba(255,255,255,0.3)', color: 'white' }}
          >
            Find Doctors
          </Link>
        </div>
      </div>
    </div>
  )
}
