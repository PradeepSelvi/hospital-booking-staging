import { useNavigate } from 'react-router-dom'

export default function DoctorCard({ doctor }) {
  const navigate = useNavigate()

  const name = doctor.profiles?.name ?? 'Doctor'
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const spec = doctor.specialization ?? 'General'
  const exp = doctor.experience_years ?? 0
  const fee = doctor.consultation_fee ?? 0
  const dept = doctor.departments?.name

  return (
    <div
      className="doctor-card"
      onClick={() => navigate(`/doctors/${doctor.id}`)}
      id={`doctor-card-${doctor.id}`}
    >
      <div className="p-4">
        {/* Header */}
        <div className="d-flex align-items-center gap-3 mb-3">
          {doctor.photo_url ? (
            <img src={doctor.photo_url} alt={name} className="doctor-avatar" />
          ) : (
            <div className="avatar" style={{ width: 60, height: 60, fontSize: 20 }}>
              {initials}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h6 style={{
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16,
              margin: 0, color: 'var(--dark)'
            }}>
              Dr. {name}
            </h6>
            <p style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, margin: '2px 0 0' }}>
              {spec}
            </p>
            {doctor.availability_status && doctor.availability_status !== 'AVAILABLE' && (
              <span className={`doctor-status-badge status-${doctor.availability_status.toLowerCase().replace('_', '-')}`} style={{ marginTop: 4 }}>
                <i className={`bi ${doctor.availability_status === 'OFFLINE' ? 'bi-moon-fill' : doctor.availability_status === 'UNAVAILABLE' ? 'bi-dash-circle-fill' : 'bi-x-circle-fill'}`} style={{ fontSize: 7 }} />
                {doctor.availability_status === 'OFFLINE' ? 'Offline' : doctor.availability_status === 'UNAVAILABLE' ? 'Unavailable' : 'Not in Service'}
              </span>
            )}
            {(!doctor.availability_status || doctor.availability_status === 'AVAILABLE') && (
              <span className="doctor-status-badge status-available" style={{ marginTop: 4 }}>
                <i className="bi bi-circle-fill" style={{ fontSize: 7 }} />
                Available
              </span>
            )}
          </div>
        </div>

        {/* Divider */}
        <hr className="divider" style={{ margin: '12px 0' }} />

        {/* Details */}
        <div className="d-flex flex-column gap-2 mb-3">
          <div className="d-flex align-items-center gap-2">
            <i className="bi bi-briefcase" style={{ color: 'var(--gray-400)', fontSize: 14 }} />
            <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>{exp} {exp === 1 ? 'year' : 'years'} experience</span>
          </div>
          {dept && (
            <div className="d-flex align-items-center gap-2">
              <i className="bi bi-building" style={{ color: 'var(--gray-400)', fontSize: 14 }} />
              <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>{dept}</span>
            </div>
          )}
          {doctor.qualification && (
            <div className="d-flex align-items-center gap-2">
              <i className="bi bi-award" style={{ color: 'var(--gray-400)', fontSize: 14 }} />
              <span style={{ fontSize: 13, color: 'var(--gray-600)' }} className="truncate">{doctor.qualification}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Consultation</span>
            <p className="doctor-fee" style={{ margin: 0 }}>₹{fee}</p>
          </div>
          <button
            className="btn-primary-custom"
            style={{ padding: '8px 18px', fontSize: 13 }}
            onClick={(e) => { e.stopPropagation(); navigate(`/doctors/${doctor.id}`) }}
          >
            Book Now <i className="bi bi-arrow-right" />
          </button>
        </div>
      </div>
    </div>
  )
}
