import { supabase } from '../lib/supabase'
import { sanitizeInput } from '../security/sanitize'

/**
 * Open (or create) the conversation between a patient and a doctor.
 * Backed by an RPC that enforces both participants share an appointment.
 */
export async function getOrCreateConversation(patientId, doctorId) {
  const { data, error } = await supabase.rpc('get_or_create_conversation', {
    p_patient_id: patientId,
    p_doctor_id: doctorId,
  })
  if (error) throw new Error(error.message || 'Could not open the conversation.')
  return data
}

/**
 * List the current user's conversations with the other party's display info
 * and an unread-message count. Works for both patients and doctors (RLS scopes
 * the rows to the caller).
 *
 * @param {string} userId - the current auth user id (to compute unread counts)
 */
export async function getConversations(userId) {
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      id, patient_id, doctor_id, last_message_at,
      patient:profiles!conversations_patient_id_fkey (name, avatar_url),
      doctor:doctors!conversations_doctor_id_fkey (
        specialization, profiles:user_id (name, avatar_url)
      )
    `)
    .order('last_message_at', { ascending: false })
  if (error) throw error

  const conversations = data ?? []
  if (conversations.length === 0) return []

  // Pull unread messages (not sent by me, not yet read) in one query.
  const ids = conversations.map(c => c.id)
  const { data: unread } = await supabase
    .from('direct_messages')
    .select('conversation_id, body, created_at, sender_id, read_at')
    .in('conversation_id', ids)
    .is('read_at', null)
    .neq('sender_id', userId)

  const unreadByConv = {}
  for (const m of unread ?? []) {
    unreadByConv[m.conversation_id] = (unreadByConv[m.conversation_id] ?? 0) + 1
  }

  return conversations.map(c => ({
    ...c,
    unreadCount: unreadByConv[c.id] ?? 0,
  }))
}

/** Fetch all messages in a conversation, oldest first. */
export async function getMessages(conversationId) {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('id, conversation_id, sender_id, body, read_at, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Send a message. sender_id must equal the current user (enforced by RLS). */
export async function sendMessage(conversationId, senderId, body) {
  const clean = sanitizeInput(body || '').trim()
  if (!clean) throw new Error('Message cannot be empty.')
  const { data, error } = await supabase
    .from('direct_messages')
    .insert([{ conversation_id: conversationId, sender_id: senderId, body: clean }])
    .select('id, conversation_id, sender_id, body, read_at, created_at')
    .single()
  if (error) throw new Error(error.message || 'Could not send the message.')
  return data
}

/** Mark all messages the other party sent in this conversation as read. */
export async function markConversationRead(conversationId, userId) {
  const { error } = await supabase
    .from('direct_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null)
  if (error) throw error
}

/**
 * Subscribe to new messages in a conversation via Supabase Realtime.
 * Returns an unsubscribe function.
 */
export function subscribeToConversation(conversationId, onInsert) {
  const channel = supabase
    .channel(`conversation:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}

/**
 * Read the doctor's "accept messages from new patients" preference.
 */
export async function getAcceptNewPatientMessages(doctorId) {
  const { data, error } = await supabase
    .from('doctors')
    .select('accept_new_patient_messages')
    .eq('id', doctorId)
    .single()
  if (error) throw error
  return data?.accept_new_patient_messages ?? true
}

/**
 * Toggle whether the doctor accepts chats from patients with no appointment
 * history. RLS allows a doctor to update only their own row.
 */
export async function setAcceptNewPatientMessages(doctorId, value) {
  const { error } = await supabase
    .from('doctors')
    .update({ accept_new_patient_messages: value })
    .eq('id', doctorId)
  if (error) throw error
  return value
}
