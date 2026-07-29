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
  getOrCreateConversation, getConversations, sendMessage,
  getAcceptNewPatientMessages, setAcceptNewPatientMessages,
} from './chat'

beforeEach(() => h.reset())

describe('getOrCreateConversation', () => {
  it('calls the RPC and returns the conversation', async () => {
    const conv = { id: 7, patient_id: 'p1', doctor_id: 3 }
    h.rpc.mockResolvedValueOnce({ data: conv, error: null })

    const result = await getOrCreateConversation('p1', 3)
    expect(result).toEqual(conv)
    expect(h.rpc).toHaveBeenCalledWith('get_or_create_conversation', { p_patient_id: 'p1', p_doctor_id: 3 })
  })

  it('throws the server message on error', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not accepting new patients' } })
    await expect(getOrCreateConversation('p1', 3)).rejects.toThrow(/not accepting/i)
  })
})

describe('getConversations', () => {
  it('returns [] when there are no conversations', async () => {
    h.queueFrom({ data: [], error: null })
    expect(await getConversations('u1')).toEqual([])
  })

  it('computes unread counts per conversation', async () => {
    h.queueFrom({ data: [{ id: 1 }, { id: 2 }], error: null }) // conversations
    h.queueFrom({ data: [                                       // unread messages
      { conversation_id: 1, sender_id: 'other' },
      { conversation_id: 1, sender_id: 'other' },
      { conversation_id: 2, sender_id: 'other' },
    ], error: null })

    const result = await getConversations('u1')
    expect(result.find(c => c.id === 1).unreadCount).toBe(2)
    expect(result.find(c => c.id === 2).unreadCount).toBe(1)
  })
})

describe('sendMessage', () => {
  it('rejects empty messages without hitting the DB', async () => {
    await expect(sendMessage(1, 'u1', '   ')).rejects.toThrow(/empty/i)
    expect(h.supabase.from).not.toHaveBeenCalled()
  })

  it('inserts and returns the saved message', async () => {
    const saved = { id: 10, conversation_id: 1, sender_id: 'u1', body: 'hi' }
    h.queueFrom({ data: saved, error: null })
    const result = await sendMessage(1, 'u1', 'hi')
    expect(result).toEqual(saved)
  })
})

describe('accept-new-patient-messages preference', () => {
  it('reads the flag, defaulting to true', async () => {
    h.queueFrom({ data: { accept_new_patient_messages: false }, error: null })
    expect(await getAcceptNewPatientMessages(3)).toBe(false)
  })

  it('writes the flag and echoes the value', async () => {
    h.queueFrom({ data: null, error: null })
    expect(await setAcceptNewPatientMessages(3, false)).toBe(false)
  })
})
