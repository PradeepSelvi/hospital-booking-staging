import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const fromQueue = []
  const rpc = vi.fn()
  const CHAIN = ['select','insert','update','delete','upsert','eq','neq','in','is',
    'gt','gte','lt','lte','like','ilike','match','contains','or','order','range','limit']
  const next = () => (fromQueue.length ? fromQueue.shift() : { data: null, error: null })
  function makeBuilder() {
    const b = {}
    for (const m of CHAIN) b[m] = vi.fn(() => b)
    b.single = vi.fn(() => Promise.resolve(next()))
    b.maybeSingle = vi.fn(() => Promise.resolve(next()))
    b.then = (res, rej) => Promise.resolve(next()).then(res, rej)
    return b
  }
  const supabase = { from: vi.fn(() => makeBuilder()), rpc }
  return {
    supabase, rpc,
    queueFrom: (r) => fromQueue.push(r),
    reset: () => { fromQueue.length = 0; rpc.mockReset(); supabase.from.mockClear() },
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: h.supabase,
  createIsolatedClient: () => h.supabase,
}))

import {
  getPatientRecordsForDoctor, logDocumentAccess, validateMedicalFile,
} from './medicalHistory'

beforeEach(() => h.reset())

describe('getPatientRecordsForDoctor (audited RPC)', () => {
  it('unpacks history + documents from the RPC payload', async () => {
    h.rpc.mockResolvedValueOnce({
      data: { history: { medical_summary: 'ok' }, documents: [{ id: 1, category: 'SHEET' }] },
      error: null,
    })
    const result = await getPatientRecordsForDoctor('p1')
    expect(h.rpc).toHaveBeenCalledWith('get_patient_records_for_doctor', { p_patient_id: 'p1' })
    expect(result.history).toEqual({ medical_summary: 'ok' })
    expect(result.documents).toHaveLength(1)
  })

  it('returns an empty shape when consent is absent', async () => {
    h.rpc.mockResolvedValueOnce({ data: { history: null, documents: [] }, error: null })
    const result = await getPatientRecordsForDoctor('p1')
    expect(result).toEqual({ history: null, documents: [] })
  })

  it('throws a friendly error when the RPC fails', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(getPatientRecordsForDoctor('p1')).rejects.toThrow(/boom|could not/i)
  })
})

describe('logDocumentAccess', () => {
  it('calls the audit RPC with the document id', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: null })
    await logDocumentAccess(42)
    expect(h.rpc).toHaveBeenCalledWith('log_medical_document_access', { p_document_id: 42 })
  })

  it('never throws even if the RPC rejects (best-effort)', async () => {
    h.rpc.mockRejectedValueOnce(new Error('network'))
    await expect(logDocumentAccess(42)).resolves.toBeUndefined()
  })
})

describe('validateMedicalFile', () => {
  it('rejects oversized files', () => {
    const big = { size: 11 * 1024 * 1024, type: 'application/pdf' }
    expect(validateMedicalFile(big).valid).toBe(false)
  })

  it('rejects disallowed formats', () => {
    const exe = { size: 1000, type: 'application/x-msdownload' }
    expect(validateMedicalFile(exe).valid).toBe(false)
  })

  it('accepts a valid PDF', () => {
    expect(validateMedicalFile({ size: 1000, type: 'application/pdf' }).valid).toBe(true)
  })
})
