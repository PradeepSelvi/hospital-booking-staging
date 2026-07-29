// prescriptions.js
// Structured prescription management (Phase 1 of prescription-pharmacy spec).
// Doctors issue/cancel; patients read their own. All writes go through
// SECURITY DEFINER RPCs that authorize the caller and notify the patient.

import { supabase } from '../lib/supabase'
import { sanitizeInput } from '../security/sanitize'

/** Common medication forms for the authoring dropdown. */
export const MED_FORMS = [
  'Tablet', 'Capsule', 'Syrup', 'Injection', 'Drops',
  'Ointment', 'Cream', 'Inhaler', 'Powder', 'Other',
]

const MAX_ITEMS = 30

/**
 * Client-side validation of a single medication line. Returns { valid, error }.
 * Mirrors the server-side required fields so users get instant feedback.
 */
export function validatePrescriptionItem(item) {
  if (!item) return { valid: false, error: 'Missing medication.' }
  for (const field of ['drug_name', 'dosage', 'frequency', 'duration']) {
    if (!String(item[field] || '').trim()) {
      return { valid: false, error: 'Each medication needs a name, dosage, frequency, and duration.' }
    }
  }
  if (item.quantity != null && item.quantity !== '' && !(Number(item.quantity) > 0)) {
    return { valid: false, error: 'Quantity must be a positive number.' }
  }
  return { valid: true }
}

/** Sanitize + shape an item array for the RPC payload. */
function cleanItems(items) {
  return (items || []).slice(0, MAX_ITEMS).map((it) => ({
    drug_name: sanitizeInput(it.drug_name || ''),
    form: it.form ? sanitizeInput(it.form) : null,
    strength: it.strength ? sanitizeInput(it.strength) : null,
    dosage: sanitizeInput(it.dosage || ''),
    frequency: sanitizeInput(it.frequency || ''),
    duration: sanitizeInput(it.duration || ''),
    quantity: it.quantity === '' || it.quantity == null ? null : Number(it.quantity),
    instructions: it.instructions ? sanitizeInput(it.instructions) : null,
    is_controlled: Boolean(it.is_controlled),
  }))
}

/**
 * Doctor: issue a structured prescription for an appointment.
 * @param {number} appointmentId
 * @param {{ diagnosis?: string, validUntil?: string|null, items: Array }} rx
 * @returns {Promise<number>} the new prescription id
 */
export async function issuePrescription(appointmentId, { diagnosis, validUntil, items }) {
  const cleaned = cleanItems(items)
  if (cleaned.length === 0) {
    throw new Error('Add at least one medication before issuing.')
  }
  for (const it of cleaned) {
    const v = validatePrescriptionItem(it)
    if (!v.valid) throw new Error(v.error)
  }

  const { data, error } = await supabase.rpc('issue_prescription', {
    p_appointment_id: appointmentId,
    p_diagnosis: diagnosis ? sanitizeInput(diagnosis) : null,
    p_valid_until: validUntil || null,
    p_items: cleaned,
  })
  if (error) throw new Error(error.message || 'Could not issue the prescription.')
  return data
}

/** Doctor: cancel an issued prescription. */
export async function cancelPrescription(prescriptionId, reason = '') {
  const { error } = await supabase.rpc('cancel_prescription', {
    p_prescription_id: prescriptionId,
    p_reason: reason ? sanitizeInput(reason) : null,
  })
  if (error) throw new Error(error.message || 'Could not cancel the prescription.')
}

/** Fetch the prescription for a single appointment (with items), or null. */
export async function getPrescriptionForAppointment(appointmentId) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*, prescription_items(*)')
    .eq('appointment_id', appointmentId)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Patient: list my prescriptions, most recent first, with items. */
export async function getMyPrescriptions(patientId) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*, prescription_items(*)')
    .eq('patient_id', patientId)
    .neq('status', 'DRAFT')
    .order('issued_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Fetch a single prescription by id (with items). RLS scopes visibility. */
export async function getPrescription(prescriptionId) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*, prescription_items(*)')
    .eq('id', prescriptionId)
    .maybeSingle()
  if (error) throw error
  return data
}
