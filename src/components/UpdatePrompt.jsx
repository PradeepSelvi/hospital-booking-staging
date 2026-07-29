import { useEffect, useRef, useState } from 'react'

// __APP_VERSION__ is injected at build time by vite.config.js (define).
const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

const POLL_INTERVAL_MS = 60_000 // check once a minute

/**
 * Detects when a newer deployment is live and prompts the user to reload.
 *
 * How it works: every build stamps a unique id into the bundle (CURRENT_VERSION)
 * and publishes the same id at /version.json. This component polls that file
 * (periodically and when the tab regains focus); if the server's version differs
 * from the one this tab booted with, a new deploy has shipped → show the popup.
 */
export default function UpdatePrompt() {
  const [updateReady, setUpdateReady] = useState(false)
  const stoppedRef = useRef(false)

  useEffect(() => {
    // Nothing to compare against in local dev (no version.json emitted).
    if (CURRENT_VERSION === 'dev') return

    async function check() {
      if (stoppedRef.current) return
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (data?.version && data.version !== CURRENT_VERSION) {
          setUpdateReady(true)
          stoppedRef.current = true // stop polling once we know
        }
      } catch {
        /* offline or transient — ignore and try again next tick */
      }
    }

    check()
    const id = setInterval(check, POLL_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!updateReady) return null

  return (
    <div className="update-prompt" role="status" aria-live="polite">
      <div className="update-prompt-icon">
        <i className="bi bi-arrow-repeat" />
      </div>
      <div className="update-prompt-body">
        <div className="update-prompt-title">A new version is available</div>
        <div className="update-prompt-text">Reload to get the latest features and fixes.</div>
      </div>
      <button className="update-prompt-btn" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button
        className="update-prompt-dismiss"
        aria-label="Dismiss"
        onClick={() => setUpdateReady(false)}
      >
        <i className="bi bi-x-lg" />
      </button>
    </div>
  )
}
