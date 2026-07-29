import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import resourcesToBackend from 'i18next-resources-to-backend'

import {
  SUPPORTED_LANGUAGE_CODES,
  FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  NAMESPACES,
  DEFAULT_NAMESPACE,
  getLanguageMeta,
} from './config'

/**
 * Lazy resource loader.
 *
 * Each `import()` becomes its own Vite chunk, so a language's JSON is only
 * fetched from the network the first time that language + namespace is needed.
 * This keeps the initial bundle small and scales cleanly as more languages and
 * namespaces are added — no central registry to maintain.
 */
const loadResources = resourcesToBackend(
  (language, namespace) => import(`../locales/${language}/${namespace}.json`)
)

// Keep <html lang> and text direction in sync with the active language for
// SEO, screen readers, and future RTL languages.
function applyDocumentLanguage(lng) {
  const meta = getLanguageMeta(lng)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = meta.code
    document.documentElement.dir = meta.dir
  }
}

i18n
  .use(loadResources)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGE_CODES,
    // Treat "en-IN"/"en-US" etc. as "en" so we don't miss region variants.
    load: 'languageOnly',
    ns: NAMESPACES,
    defaultNS: DEFAULT_NAMESPACE,
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      // React already escapes values, so i18next escaping would double-encode.
      escapeValue: false,
    },
    react: {
      useSuspense: true,
    },
    returnEmptyString: false,
  })

i18n.on('languageChanged', applyDocumentLanguage)
applyDocumentLanguage(i18n.resolvedLanguage || FALLBACK_LANGUAGE)

export default i18n
