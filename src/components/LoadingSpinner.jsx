export default function LoadingSpinner({ fullPage = false, size = 40, text = '' }) {
  if (fullPage) {
    return (
      <div className="page-loader">
        <div className="text-center">
          <div className="spinner-custom mx-auto mb-3" style={{ width: size, height: size }} />
          {text && <p style={{ color: 'var(--gray-400)', fontSize: 14 }}>{text}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="d-flex justify-content-center align-items-center py-5">
      <div className="text-center">
        <div className="spinner-custom mx-auto mb-3" style={{ width: size, height: size }} />
        {text && <p style={{ color: 'var(--gray-400)', fontSize: 14 }}>{text}</p>}
      </div>
    </div>
  )
}
