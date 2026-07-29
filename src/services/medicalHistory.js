import { supabase } from '../lib/supabase'
import { sanitizeFormData, sanitizeInput } from '../security/sanitize'

const BUCKET = 'medical-records'

// ─────────────────────────────────────────────
// Upload constraints
// ─────────────────────────────────────────────
// Per-category: max 3 files. Format + size constraints apply to all.
export const MEDICAL_DOC_CONSTRAINTS = {
  maxPerCategory: 3,
  maxSize: 10 * 1024 * 1024, // 10MB
  maxSizeLabel: '10MB',
  allowedTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
  label: 'PDF, JPG, PNG or WEBP',
}

export const DOC_CATEGORIES = [
  { key: 'SHEET', label: 'Medical Sheets', icon: 'bi-file-medical', hint: 'Lab reports, prescriptions, discharge summaries' },
  { key: 'SCAN', label: 'Scans', icon: 'bi-radioactive', hint: 'X-rays, MRI, CT, ultrasound images' },
  { key: 'OTHER', label: 'Other Files', icon: 'bi-folder', hint: 'Insurance, referrals, anything else' },
]

/**
 * Validate a file against size + format constraints.
 * Returns { valid, error }.
 */
export function validateMedicalFile(file) {
  if (!file) return { valid: false, error: 'No file selected.' }
  if (file.size > MEDICAL_DOC_CONSTRAINTS.maxSize) {
    return {
      valid: false,
      error: `File must be under ${MEDICAL_DOC_CONSTRAINTS.maxSizeLabel}. Yours is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`,
    }
  }
  if (!MEDICAL_DOC_CONSTRAINTS.allowedTypes.includes(file.type)) {
    return { valid: false, error: `Invalid format. Allowed: ${MEDICAL_DOC_CONSTRAINTS.label}.` }
  }
  return { valid: true }
}

// ─────────────────────────────────────────────
// Medical history (text fields)
// ─────────────────────────────────────────────
export async function getMedicalHistory(patientId) {
  const { data, error } = await supabase
    .from('medical_history').select('*').eq('patient_id', patientId).maybeSingle()
  if (error) throw error
  return data
}

export async function upsertMedicalHistory(patientId, fields) {
  const payload = sanitizeFormData({
    patient_id: patientId,
    medical_summary: fields.medical_summary || null,
    previous_concerns: fields.previous_concerns || null,
    current_medications: fields.current_medications || null,
    allergies: fields.allergies || null,
    chronic_conditions: fields.chronic_conditions || null,
    other_info: fields.other_info || null,
  })
  const { data, error } = await supabase
    .from('medical_history')
    .upsert(payload, { onConflict: 'patient_id' })
    .select().single()
  if (error) throw error
  return data
}

// ─────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────
export async function getMedicalDocuments(patientId) {
  const { data, error } = await supabase
    .from('medical_documents').select('*')
    .eq('patient_id', patientId)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Group a flat list of docs by category for easy rendering. */
export function groupByCategory(docs) {
  const groups = { SHEET: [], SCAN: [], OTHER: [] }
  for (const d of docs) (groups[d.category] ??= []).push(d)
  return groups
}

/**
 * Upload a document into a category. Enforces the per-category limit of 3
 * client-side; the DB trigger is the hard backstop against races.
 */
export async function uploadMedicalDocument(patientId, category, file, label = '') {
  const v = validateMedicalFile(file)
  if (!v.valid) throw new Error(v.error)

  // Client-side count check for a friendly message.
  const existing = await getMedicalDocuments(patientId)
  const inCategory = existing.filter(d => d.category === category)
  if (inCategory.length >= MEDICAL_DOC_CONSTRAINTS.maxPerCategory) {
    throw new Error(`You can upload at most ${MEDICAL_DOC_CONSTRAINTS.maxPerCategory} files in this section.`)
  }

  const ext = file.name.split('.').pop().toLowerCase()
  const ts = Date.now()
  const path = `${patientId}/${category.toLowerCase()}/${ts}.${ext}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false })
  if (upErr) throw upErr

  const { data, error } = await supabase
    .from('medical_documents')
    .insert([{
      patient_id: patientId,
      category,
      file_name: sanitizeInput(file.name),
      file_path: path,
      file_size: file.size,
      mime_type: file.type,
      label: sanitizeInput(label || ''),
    }])
    .select().single()

  if (error) {
    // Roll back the orphaned upload if the row insert failed (e.g. trigger limit).
    await supabase.storage.from(BUCKET).remove([path])
    throw new Error(error.message || 'Could not save the document.')
  }
  return data
}

export async function deleteMedicalDocument(docId) {
  const { data: doc, error: fErr } = await supabase
    .from('medical_documents').select('file_path').eq('id', docId).single()
  if (fErr) throw new Error('Document not found.')

  if (doc?.file_path) {
    await supabase.storage.from(BUCKET).remove([doc.file_path])
  }
  const { error } = await supabase.from('medical_documents').delete().eq('id', docId)
  if (error) throw error
}

/** Short-lived signed URL to view/download a private document. */
export async function getDocumentUrl(filePath, expiresIn = 3600) {
  if (!filePath) return null
  const { data, error } = await supabase.storage
    .from(BUCKET).createSignedUrl(filePath, expiresIn)
  if (error) throw error
  return data?.signedUrl ?? null
}

// ─────────────────────────────────────────────
// Access grants (patient ↔ doctor, per appointment)
// ─────────────────────────────────────────────
export async function getGrantForAppointment(appointmentId) {
  const { data, error } = await supabase
    .from('medical_access_grants').select('*')
    .eq('appointment_id', appointmentId).maybeSingle()
  if (error) throw error
  return data
}

/** Patient grants the appointment's doctor access to their records. */
export async function grantRecordAccess(appointmentId, patientId, doctorId) {
  const { data, error } = await supabase
    .from('medical_access_grants')
    .upsert(
      { appointment_id: appointmentId, patient_id: patientId, doctor_id: doctorId, is_active: true, revoked_at: null },
      { onConflict: 'appointment_id' }
    )
    .select().single()
  if (error) throw error
  return data
}

/** Patient revokes a previously granted access. */
export async function revokeRecordAccess(appointmentId) {
  const { data, error } = await supabase
    .from('medical_access_grants')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('appointment_id', appointmentId)
    .select().single()
  if (error) throw error
  return data
}

/**
 * Doctor view: fetch a patient's history + documents for an appointment.
 *
 * Routes through the audited `get_patient_records_for_doctor` RPC, which logs
 * the access server-side (tamper-resistant) and returns data only when the
 * patient has granted consent. Returns the same `{ history, documents }` shape
 * as before; an empty/!consented response yields `{ history: null, documents: [] }`.
 */
export async function getPatientRecordsForDoctor(patientId) {
  const { data, error } = await supabase.rpc('get_patient_records_for_doctor', {
    p_patient_id: patientId,
  })
  if (error) throw new Error(error.message || 'Could not load patient records.')
  return {
    history: data?.history ?? null,
    documents: data?.documents ?? [],
  }
}

/**
 * Record that a doctor opened a specific document (server-side audit).
 * No-op for the owning patient or anyone without consent. Best-effort:
 * never blocks the actual file view.
 */
export async function logDocumentAccess(documentId) {
  try {
    await supabase.rpc('log_medical_document_access', { p_document_id: documentId })
  } catch {
    /* auditing must not break the UX */
  }
}

/**
 * Patient-facing transparency: who has viewed my records, most recent first.
 */
export async function getMyRecordAccessLog(patientId) {
  const { data, error } = await supabase
    .from('medical_record_access_log')
    .select('id, accessor_id, doctor_id, access_type, document_id, accessed_at')
    .eq('patient_id', patientId)
    .order('accessed_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// ─────────────────────────────────────────────
// Consultation notes (doctor closing the appointment)
// ─────────────────────────────────────────────
export async function getConsultationNote(appointmentId) {
  const { data, error } = await supabase
    .from('consultation_notes').select('*')
    .eq('appointment_id', appointmentId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveConsultationNote(appointmentId, doctorId, patientId, note) {
  const payload = sanitizeFormData({
    appointment_id: appointmentId,
    doctor_id: doctorId,
    patient_id: patientId,
    advisory: note.advisory || null,
    prescription: note.prescription || null,
    follow_up: note.follow_up || null,
  })
  const { data, error } = await supabase
    .from('consultation_notes')
    .upsert(payload, { onConflict: 'appointment_id' })
    .select().single()
  if (error) throw error
  return data
}
