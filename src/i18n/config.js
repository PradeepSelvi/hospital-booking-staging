/**
 * Central place to declare which languages the app ships with.
 *
 * Add a new language by:
 *   1. Adding an entry here (code + label + dir).
 *   2. Creating matching JSON files under `src/locales/<code>/<namespace>.json`.
 * The resource loader (see ./index.js) discovers files lazily, so no other
 * wiring is required.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', dir: 'ltr' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', dir: 'ltr' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', dir: 'ltr' },
]

export const DEFAULT_LANGUAGE = 'en'
export const FALLBACK_LANGUAGE = 'en'

// Persisted under this key by the browser language detector.
export const LANGUAGE_STORAGE_KEY = 'medibook_lang'

// Namespaces let us split translations into logical, independently-loadable
// files. `common` is loaded eagerly; feature namespaces load on demand.
export const NAMESPACES = ['common']
export const DEFAULT_NAMESPACE = 'common'

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code)

export function getLanguageMeta(code) {
  return (
    SUPPORTED_LANGUAGES.find((l) => l.code === code) ||
    SUPPORTED_LANGUAGES.find((l) => l.code === FALLBACK_LANGUAGE)
  )
}
