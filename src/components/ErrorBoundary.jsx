import React from 'react'
import { Link } from 'react-router-dom'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--gray-50)',
          padding: 24
        }}>
          <div className="text-center" style={{ maxWidth: 480 }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: 'rgba(239,35,60,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 24px'
            }}>
              <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: 32, color: '#EF233C' }} />
            </div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--dark)' }}>
              Something Went Wrong
            </h3>
            <p style={{ color: 'var(--gray-500)', fontSize: 15, margin: '8px 0 24px' }}>
              An unexpected error occurred. Please try refreshing the page.
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <pre style={{
                background: '#1E293B', color: '#F87171', padding: 16,
                borderRadius: 8, fontSize: 13, textAlign: 'left',
                overflowX: 'auto', marginBottom: 24, maxHeight: 200
              }}>
                {this.state.error.toString()}
              </pre>
            )}
            <div className="d-flex gap-3 justify-content-center">
              <button
                className="btn-primary-custom"
                onClick={() => window.location.reload()}
              >
                <i className="bi bi-arrow-clockwise" /> Refresh Page
              </button>
              <a href="/" className="btn-outline-custom">
                <i className="bi bi-house" /> Go Home
              </a>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
