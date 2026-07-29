import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'
import { submitContactMessage, CONTACT_TYPES } from '../services/support'

const EMPTY = { name: '', email: '', type: 'QUERY', subject: '', message: '' }

export default function ContactSupportSection() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      setSubmitting(true)
      await submitContactMessage(form, user?.id ?? null)
      toast.success('Thank you! Your message has been sent.')
      setForm(EMPTY)
    } catch (err) {
      toast.error(err.message || 'Failed to send message')
    } finally {
      setSubmitting(false)
    }
  }

  function goToComplaints() {
    if (!user) {
      toast.info('Please log in to raise or track a complaint')
      navigate('/login', { state: { from: { pathname: '/complaints' } } })
      return
    }
    navigate('/complaints')
  }

  return (
    <section id="contact" style={{ padding: '80px 0', background: 'var(--gray-50)' }}>
      <div className="container">
        <div className="text-center mb-5">
          <div className="section-badge">Get in Touch</div>
          <h2 className="section-title">Contact, Feedback & Complaints</h2>
          <p className="section-subtitle">We're here to help. Send us a message or raise a complaint.</p>
        </div>

        <div className="row g-4">
          {/* Feedback / Query / Contact form */}
          <div className="col-lg-7">
            <div className="card-custom p-4 h-100">
              <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 6 }}>
                <i className="bi bi-chat-dots me-2 text-primary" />Send a Message
              </h5>
              <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 20 }}>
                Share feedback or ask a question — no account needed.
              </p>
              <form onSubmit={handleSubmit} noValidate>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label-custom">Name *</label>
                    <input
                      type="text"
                      className="form-input-custom"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      maxLength={100}
                      placeholder="Your name"
                      required
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label-custom">Email *</label>
                    <input
                      type="email"
                      className="form-input-custom"
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      maxLength={254}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label-custom">Type *</label>
                    <select
                      className="form-input-custom"
                      value={form.type}
                      onChange={e => setForm({ ...form, type: e.target.value })}
                    >
                      {CONTACT_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label-custom">Subject</label>
                    <input
                      type="text"
                      className="form-input-custom"
                      value={form.subject}
                      onChange={e => setForm({ ...form, subject: e.target.value })}
                      maxLength={150}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label-custom">Message *</label>
                    <textarea
                      className="form-input-custom"
                      rows={4}
                      value={form.message}
                      onChange={e => setForm({ ...form, message: e.target.value })}
                      maxLength={2000}
                      placeholder="How can we help?"
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn-primary-custom mt-3" disabled={submitting}>
                  {submitting ? (
                    <><div className="spinner-custom" style={{ width: 18, height: 18, borderWidth: 2 }} /> Sending...</>
                  ) : (
                    <><i className="bi bi-send me-1" />Send Message</>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Complaints CTA + contact details */}
          <div className="col-lg-5">
            <div className="card-custom p-4 mb-4" style={{
              background: 'linear-gradient(135deg, #03045E 0%, #0077B6 100%)', border: 'none'
            }}>
              <h5 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'white', marginBottom: 8 }}>
                <i className="bi bi-shield-exclamation me-2" />Raise a Complaint
              </h5>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.7, marginBottom: 16 }}>
                Patients, doctors and hospitals can file complaints or petitions and track their
                status. You'll need to be logged in so we can verify and follow up.
              </p>
              <ul className="list-unstyled d-flex flex-column gap-2 mb-3" style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
                <li><i className="bi bi-check-circle me-2" />Patients → against a doctor or hospital</li>
                <li><i className="bi bi-check-circle me-2" />Doctors → against a hospital or patient</li>
                <li><i className="bi bi-check-circle me-2" />Hospitals → petitions against their doctors</li>
                <li><i className="bi bi-check-circle me-2" />Anyone → about website management</li>
              </ul>
              <button
                className="btn-primary-custom w-100 justify-content-center"
                style={{ background: 'white', color: 'var(--primary)' }}
                onClick={goToComplaints}
              >
                {user ? 'Raise / Track a Complaint' : 'Log in to Raise a Complaint'}
                <i className="bi bi-arrow-right ms-1" />
              </button>
              {user && (
                <Link to="/complaints" style={{ display: 'block', textAlign: 'center', marginTop: 10, color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
                  Track existing complaints
                </Link>
              )}
            </div>

            <div className="card-custom p-4">
              <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 14 }}>Reach Us</h6>
              <div className="d-flex flex-column gap-3">
                <div className="d-flex align-items-center gap-3">
                  <i className="bi bi-envelope" style={{ color: 'var(--primary)', fontSize: 18 }} />
                  <span style={{ fontSize: 14, color: 'var(--gray-600)' }}>support@medibook.com</span>
                </div>
                <div className="d-flex align-items-center gap-3">
                  <i className="bi bi-telephone" style={{ color: 'var(--primary)', fontSize: 18 }} />
                  <span style={{ fontSize: 14, color: 'var(--gray-600)' }}>+1 (555) 123-4567</span>
                </div>
                <div className="d-flex align-items-center gap-3">
                  <i className="bi bi-geo-alt" style={{ color: 'var(--primary)', fontSize: 18 }} />
                  <span style={{ fontSize: 14, color: 'var(--gray-600)' }}>123 Medical Center Drive, Health City</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
