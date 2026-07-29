import { supabase } from '../lib/supabase'
import { sanitizeInput, sanitizeEmail, sanitizeName } from '../security/sanitize'

export const CONTACT_TYPES = [
  { value: 'FEEDBACK', label: 'Feedback' },
  { value: 'QUERY', label: 'Query' },
  { value: 'CONTACT', label: 'Contact / General' },
  { value: 'OTHER', label: 'Other' },
]

const VALID_TYPES = CONTACT_TYPES.map(t => t.value)

/**
 * Submit a public contact / feedback / query message.
 * No authentication required. Optionally links to the logged-in user.
 */
export async function submitContactMessage(form, userId = null) {
  const name = sanitizeName(form.name || '')
  const email = sanitizeEmail(form.email || '')
  const type = VALID_TYPES.includes(form.type) ? form.type : 'QUERY'
  const subject = sanitizeInput(form.subject || '').slice(0, 150)
  const message = sanitizeInput(form.message || '').slice(0, 2000)

  if (!name) throw new Error('Please enter your name')
  if (!email) throw new Error('Please enter your email')
  if (!message) throw new Error('Please enter a message')

  const { data, error } = await supabase
    .from('contact_messages')
    .insert([{
      user_id: userId,
      name,
      email,
      type,
      subject: subject || null,
      message,
      status: 'NEW',
    }])
    .select()
    .single()

  if (error) throw error
  return data
}

// ── Admin ──

export async function getContactMessages(filters = {}) {
  let query = supabase
    .from('contact_messages')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters.status && filters.status !== 'ALL') query = query.eq('status', filters.status)
  if (filters.type) query = query.eq('type', filters.type)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function updateContactMessageStatus(id, status, adminNotes) {
  const updates = { status }
  if (adminNotes !== undefined) updates.admin_notes = adminNotes
  const { data, error } = await supabase
    .from('contact_messages')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getContactStats() {
  const { data, error } = await supabase.from('contact_messages').select('status')
  if (error) throw error
  const stats = { total: data?.length ?? 0, new: 0 }
  for (const row of data ?? []) {
    if (row.status === 'NEW') stats.new++
  }
  return stats
}
