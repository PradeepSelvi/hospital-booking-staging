import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n/config'

/**
 * Language selector. Uses a native <select> so it works everywhere (mobile,
 * keyboard, screen readers) with zero extra styling dependencies. Changing the
 * value switches the active language; i18next persists the choice to
 * localStorage and updates <html lang> automatically (see src/i18n).
 */
export default function LanguageSwitcher({ className = '', compact = false }) {
  const { i18n, t } = useTranslation()

  const current =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.resolvedLanguage)?.code ||
    i18n.language ||
    'en'

  function handleChange(e) {
    i18n.changeLanguage(e.target.value)
  }

  return (
    <label className={`d-inline-flex align-items-center gap-1 ${className}`}>
      <i className="bi bi-translate" aria-hidden="true" />
      <span className="visually-hidden">{t('language.select')}</span>
      <select
        className="form-select form-select-sm border-0 bg-transparent"
        style={{ width: 'auto', cursor: 'pointer', boxShadow: 'none' }}
        value={current}
        onChange={handleChange}
        aria-label={t('language.select')}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {compact ? lang.code.toUpperCase() : lang.native}
          </option>
        ))}
      </select>
    </label>
  )
}
