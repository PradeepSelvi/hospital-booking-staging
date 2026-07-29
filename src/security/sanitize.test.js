import { describe, it, expect } from 'vitest'
import {
  sanitizeInput, sanitizeEmail, sanitizePhone, sanitizeName,
  sanitizeSearchTerm, sanitizeNumeric, sanitizeFormData, sanitizeForDisplay,
  isReasonableDate, isValidPhone, isValidEmail,
} from './sanitize'

describe('sanitizeInput', () => {
  it('strips HTML tags', () => {
    expect(sanitizeInput('<b>hello</b>')).toBe('hello')
    expect(sanitizeInput('<script>alert(1)</script>x')).toBe('alert(1)x')
  })

  it('removes javascript: and inline handlers', () => {
    expect(sanitizeInput('javascript:alert(1)')).toBe('alert(1)')
    expect(sanitizeInput('onclick=evil')).toBe('evil')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitizeInput('  a    b  ')).toBe('a b')
  })

  it('passes through non-strings untouched', () => {
    expect(sanitizeInput(42)).toBe(42)
    expect(sanitizeInput(null)).toBe(null)
  })
})

describe('sanitizeEmail / sanitizePhone / sanitizeName', () => {
  it('lowercases and trims email', () => {
    expect(sanitizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com')
  })

  it('keeps leading + and strips non-digits from phone', () => {
    expect(sanitizePhone('+91 (98765) 43210')).toBe('+919876543210')
    expect(sanitizePhone('98765-43210')).toBe('9876543210')
    expect(sanitizePhone('')).toBe('')
  })

  it('strips digits/symbols from names', () => {
    expect(sanitizeName('John2 Doe!')).toBe('John Doe')
  })
})

describe('sanitizeSearchTerm', () => {
  it('removes PostgREST filter control characters', () => {
    const out = sanitizeSearchTerm('a,b(c)*d%e_f')
    expect(out).not.toMatch(/[,()*%_]/)
  })

  it('clamps to maxLength', () => {
    expect(sanitizeSearchTerm('a'.repeat(100), 10).length).toBe(10)
  })

  it('returns empty string for non-strings', () => {
    expect(sanitizeSearchTerm(null)).toBe('')
  })
})

describe('sanitizeNumeric', () => {
  it('clamps within range', () => {
    expect(sanitizeNumeric(150, 0, 100)).toBe(100)
    expect(sanitizeNumeric(-5, 0, 100)).toBe(0)
    expect(sanitizeNumeric('42', 0, 100)).toBe(42)
  })

  it('falls back to min for NaN', () => {
    expect(sanitizeNumeric('abc', 7, 100)).toBe(7)
  })
})

describe('sanitizeFormData', () => {
  it('preserves id-like keys without sanitizing', () => {
    const out = sanitizeFormData({ patient_id: '<x>', id: 5 })
    expect(out.patient_id).toBe('<x>')
    expect(out.id).toBe(5)
  })

  it('applies field-specific sanitizers', () => {
    const out = sanitizeFormData({ email: ' A@B.COM ', phone: '+91 99', name: 'Al!ce' })
    expect(out.email).toBe('a@b.com')
    expect(out.phone).toBe('+9199')
    expect(out.name).toBe('Alce')
  })

  it('clamps known numeric fields', () => {
    const out = sanitizeFormData({ consultation_fee: 999999, experience_years: -3 })
    expect(out.consultation_fee).toBe(100000)
    expect(out.experience_years).toBe(0)
  })

  it('recurses into nested objects and arrays', () => {
    const out = sanitizeFormData({ nested: { bio: '<i>hi</i>' }, list: ['<b>x</b>'] })
    expect(out.nested.bio).toBe('hi')
    expect(out.list[0]).toBe('x')
  })
})

describe('sanitizeForDisplay', () => {
  it('escapes HTML entities', () => {
    expect(sanitizeForDisplay('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#039;')
  })
})

describe('validators kept in sanitize', () => {
  it('isValidEmail', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('nope')).toBe(false)
  })

  it('isValidPhone', () => {
    expect(isValidPhone('+91 98765 43210')).toBe(true)
    expect(isValidPhone('123')).toBe(false)
  })

  it('isReasonableDate rejects past and far-future dates', () => {
    const today = new Date().toISOString().split('T')[0]
    expect(isReasonableDate(today)).toBe(true)
    expect(isReasonableDate('2000-01-01')).toBe(false)
  })
})
