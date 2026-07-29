import { describe, it, expect } from 'vitest'
import {
  validateField, validatePhone, validateForm, getPasswordStrength,
} from './validators'

describe('validateField', () => {
  it('flags required empty fields', () => {
    expect(validateField('email', '', { required: true }).valid).toBe(false)
  })

  it('passes optional empty fields', () => {
    expect(validateField('bio', '', {}).valid).toBe(true)
  })

  it('validates email pattern', () => {
    expect(validateField('email', 'a@b.com').valid).toBe(true)
    expect(validateField('email', 'bad').valid).toBe(false)
  })

  it('enforces maxLength', () => {
    expect(validateField('bio', 'x'.repeat(501)).valid).toBe(false)
  })

  it('enforces numeric range', () => {
    expect(validateField('consultationFee', 200000).valid).toBe(false)
    expect(validateField('consultationFee', 500).valid).toBe(true)
  })

  it('rejects future date of birth', () => {
    const future = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    expect(validateField('dateOfBirth', future).valid).toBe(false)
  })

  it('returns valid for unknown field names', () => {
    expect(validateField('unknown', 'anything').valid).toBe(true)
  })
})

describe('validatePhone', () => {
  it('accepts a well-formed number with separators', () => {
    expect(validatePhone('+91 98765 43210').valid).toBe(true)
  })

  it('rejects a short number', () => {
    expect(validatePhone('123', true).valid).toBe(false)
  })

  it('passes empty when not required', () => {
    expect(validatePhone('', false).valid).toBe(true)
  })
})

describe('validateForm', () => {
  it('aggregates errors across fields', () => {
    const { valid, errors } = validateForm(
      { email: 'bad', name: 'A' },
      { email: { required: true }, name: { required: true } }
    )
    expect(valid).toBe(false)
    expect(errors.email).toBeTruthy()
    expect(errors.name).toBeTruthy()
  })

  it('passes a clean form', () => {
    const { valid } = validateForm(
      { email: 'a@b.com', name: 'Alice' },
      { email: { required: true }, name: { required: true } }
    )
    expect(valid).toBe(true)
  })
})

describe('getPasswordStrength', () => {
  it('rates a weak password low', () => {
    expect(getPasswordStrength('abc').level).toBeLessThanOrEqual(2)
  })

  it('rates a complex password high', () => {
    expect(getPasswordStrength('Abcdef1!ghij').level).toBeGreaterThanOrEqual(4)
  })

  it('returns level 0 for empty', () => {
    expect(getPasswordStrength('').level).toBe(0)
  })
})
