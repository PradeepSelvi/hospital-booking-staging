import { describe, it, expect, beforeEach, vi } from 'vitest'

// Self-contained Supabase mock, created inside vi.hoisted so the service
// picks it up at import time. Builder methods chain; awaiting a chain (or
// .single()/.maybeSingle()) resolves to the next result queued via queueFrom.
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

import { bookAppointment, searchDoctorPatients } from './appointments'

const FUTURE_DATE = '2099-06-15'

beforeEach(() => h.reset())

describe('bookAppointment — atomic RPC path', () => {
  it('returns the row when the RPC succeeds', async () => {
    const row = { id: 1, status: 'PENDING' }
    h.rpc.mockResolvedValueOnce({ data: row, error: null })

    const result = await bookAppointment({
      doctor_id: 5, appointment_date: FUTURE_DATE, slot_start_time: '10:00', reason: 'x',
    })

    expect(result).toEqual(row)
    expect(h.rpc).toHaveBeenCalledWith('book_appointment', expect.objectContaining({
      p_doctor_id: 5, p_date: FUTURE_DATE, p_start_time: '10:00',
    }))
  })

  it('rejects past dates before hitting the database', async () => {
    await expect(bookAppointment({
      doctor_id: 5, appointment_date: '2000-01-01', slot_start_time: '10:00',
    })).rejects.toThrow(/past/i)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('maps a slot-taken error to a friendly message', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'taken' } })
    await expect(bookAppointment({
      doctor_id: 5, appointment_date: FUTURE_DATE, slot_start_time: '10:00',
    })).rejects.toThrow(/just booked|already/i)
  })
})

describe('bookAppointment — fallback when RPC is not deployed', () => {
  it('falls back to a direct insert and returns the inserted row', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    h.queueFrom({ data: { id: 5, is_active: true }, error: null })   // doctor lookup
    h.queueFrom({ data: null, error: null })                          // no existing appointment
    h.queueFrom({ data: { slot_duration_mins: 30 }, error: null })    // availability
    const inserted = { id: 99, status: 'PENDING', slot_end_time: '10:30' }
    h.queueFrom({ data: inserted, error: null })                      // insert result

    const result = await bookAppointment({
      patient_id: 'uuid-1', doctor_id: 5, appointment_date: FUTURE_DATE, slot_start_time: '10:00', reason: 'x',
    })

    expect(result).toEqual(inserted)
  })

  it('rejects in fallback when the slot is already taken', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    h.queueFrom({ data: { id: 5, is_active: true }, error: null })    // doctor lookup
    h.queueFrom({ data: { id: 1 }, error: null })                     // existing appointment found

    await expect(bookAppointment({
      patient_id: 'uuid-1', doctor_id: 5, appointment_date: FUTURE_DATE, slot_start_time: '10:00',
    })).rejects.toThrow(/already booked/i)
  })

  it('rejects in fallback when the doctor is inactive', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    h.queueFrom({ data: { id: 5, is_active: false }, error: null })   // inactive doctor

    await expect(bookAppointment({
      patient_id: 'uuid-1', doctor_id: 5, appointment_date: FUTURE_DATE, slot_start_time: '10:00',
    })).rejects.toThrow(/unavailable/i)
  })
})

describe('searchDoctorPatients', () => {
  const appts = [
    // The real query orders by appointment_date DESC; the mock returns rows
    // as-is, so the fixture is pre-sorted newest-first like the DB would.
    { patient_id: 'p1', appointment_date: '2025-05-01', status: 'CONFIRMED', profiles: { name: 'Alice Smith', phone: '+91 98765 43210', email: 'a@x.com' } },
    { patient_id: 'p2', appointment_date: '2025-04-01', status: 'COMPLETED', profiles: { name: 'Bob Jones', phone: '8001234567', email: 'b@x.com' } },
    { patient_id: 'p1', appointment_date: '2025-03-10', status: 'COMPLETED', profiles: { name: 'Alice Smith', phone: '+91 98765 43210', email: 'a@x.com' } },
  ]

  it('returns empty without a doctorId', async () => {
    expect(await searchDoctorPatients(null)).toEqual([])
  })

  it('dedupes by patient and counts visits', async () => {
    h.queueFrom({ data: appts, error: null })
    const result = await searchDoctorPatients(5, '')

    expect(result).toHaveLength(2)
    const alice = result.find(r => r.patient_id === 'p1')
    expect(alice.totalVisits).toBe(2)
    expect(alice.lastVisit).toBe('2025-05-01') // newest-first ⇒ first seen is latest
  })

  it('filters by name (case-insensitive)', async () => {
    h.queueFrom({ data: appts, error: null })
    const result = await searchDoctorPatients(5, 'bob')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Bob Jones')
  })

  it('matches phone ignoring spaces, +, and dashes', async () => {
    h.queueFrom({ data: appts, error: null })
    const result = await searchDoctorPatients(5, '98765-43210')
    expect(result).toHaveLength(1)
    expect(result[0].patient_id).toBe('p1')
  })
})
