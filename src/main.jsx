import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './i18n' // initialize i18next before the app renders
import './index.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'react-toastify/dist/ReactToastify.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* i18next loads translation chunks lazily; Suspense holds the first
          paint until the initial language + `common` namespace are ready. */}
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
)
