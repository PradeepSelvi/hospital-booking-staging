import { supabase } from '../lib/supabase'
import { sanitizeInput } from '../security/sanitize'
import { getDoctorByUserId } from './doctors'
import { getHospitalByOwnerId, getHospitalDoctors } from './hospital'

// ─────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────

export const COMPLAINT_CATEGORIES = [
  { value: 'BEHAVIOUR', label: 'Behaviour / Conduct' },
  { value: 'PAYMENT', label: 'Payment / Money Issue' },
  { value: 'SERVICE_QUALITY', label: 'Service Quality' },
  { value: 'MISCONDUCT', label: 'Professional Misconduct' },
  { value: 'FACILITY', label: 'Facility / Infrastructure' },
  { value: 'NEGLIGENCE', label: 'Negligence' },
  { value: 'MANAGEMENT', label: 'Website Management / Authority' },
  { value: 'OTHER', label: 'Other' },
]

export const COMPLAINT_STATUS = {
  OPEN: { label: 'Open', badge: 'badge-pending', icon: 'bi-folder2-open', color: '#F59E0B' },
  UNDER_REVIEW: { label: 'Under Review', badge: 'badge-confirmed', icon: 'bi-eye', color: '#0077B6' },
  RESOLVED: { label: 'Resolved', badge: 'badge-confirmed', icon: 'bi-check-circle', color: '#2DC653' },
  ACTION_TAKEN: { label: 'Action Taken', badge: 'badge-confirmed', icon: 'bi-shield-check', color: '#2DC653' },
  REJECTED: { label: 'Rejected', badge: 'badge-cancelled', icon: 'bi-x-circle', color: '#EF233C' },
}

/**
 * Which target types each complainant role is allowed to file against.
 */
export const ALLOWED_TARGETS = {
  PATIENT: ['DOCTOR', 'HOSPITAL', 'MANAGEMENT'],
  DOCTOR: ['HOSPITAL', 'PATIENT', 'MANAGEMENT'],
  HOSPITAL: ['DOCTOR', 'MANAGEMENT'],
}

export const TARGET_LABELS = {
  DOCTOR: 'A Doctor',
  HOSPITAL: 'A Hospital',
  PATIENT: 'A Patient',
  MANAGEMENT: 'Website Management / Authority',
}

// ─────────────────────────────────────────────
// Target option loaders (role-aware, privacy-conscious)
// ─────────────────────────────────────────────

/**
 * Return the selectable target entities for a given complainant.
 * Each option: { id, label, doctorId?, hospitalId?, patientUserId? }
 *
 * Only relevant/related entities are exposed:
 *   • PATIENT  → all active doctors & hospitals (public directory)
 *   • DOCTOR   → hospitals they are affiliated with, patients they have seen
 *   • HOSPITAL → doctors affiliated with that hospital
 */
export async function getComplaintTargets(targetType, role, userId) {
  if (targetType === 'MANAGEMENT') return []

  if (targetType === 'DOCTOR') {
    if (role === 'PATIENT') {
      const { data, error } = await supabase
        .from('doctors')
        .select('id, specialization, profiles:user_id (name)')
        .eq('is_active', true)
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []).map(d => ({
        id: `doctor-${d.id}`,
        doctorId: d.id,
        label: `Dr. ${d.profiles?.name ?? 'Unknown'}${d.specialization ? ' — ' + d.specialization : ''}`,
      }))
    }
    if (role === 'HOSPITAL') {
      const hospital = await getHospitalByOwnerId(userId)
      if (!hospital) return []
      const affiliations = await getHospitalDoctors(hospital.id)
      return (affiliations ?? [])
        .filter(a => a.doctors)
        .map(a => ({
          id: `doctor-${a.doctors.id}`,
          doctorId: a.doctors.id,
          label: `Dr. ${a.doctors.profiles?.name ?? 'Unknown'}${a.doctors.specialization ? ' — ' + a.doctors.specialization : ''}`,
        }))
    }
  }

  if (targetType === 'HOSPITAL') {
    if (role === 'PATIENT') {
      const { data, error } = await supabase
        .from('hospitals')
        .select('id, name, city')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []).map(h => ({
        id: `hospital-${h.id}`,
        hospitalId: h.id,
        label: `${h.name}${h.city ? ' — ' + h.city : ''}`,
      }))
    }
    if (role === 'DOCTOR') {
      const doctor = await getDoctorByUserId(userId)
      if (!doctor) return []
      const { data, error } = await supabase
        .from('doctor_hospital_affiliations')
        .select('hospital_id, hospitals (id, name, city)')
        .eq('doctor_id', doctor.id)
        .eq('status', 'APPROVED')
      if (error) throw error
      return (data ?? [])
        .filter(a => a.hospitals)
        .map(a => ({
          id: `hospital-${a.hospitals.id}`,
          hospitalId: a.hospitals.id,
          label: `${a.hospitals.name}${a.hospitals.city ? ' — ' + a.hospitals.city : ''}`,
        }))
    }
  }

  if (targetType === 'PATIENT' && role === 'DOCTOR') {
    const doctor = await getDoctorByUserId(userId)
    if (!doctor) return []
    // Only patients this doctor has appointments with (privacy-conscious)
    const { data, error } = await supabase
      .from('appointments')
      .select('patient_id, profiles:patient_id (name)')
      .eq('doctor_id', doctor.id)
    if (error) throw error
    const seen = new Map()
    for (const row of data ?? []) {
      if (row.patient_id && !seen.has(row.patient_id)) {
        seen.set(row.patient_id, {
          id: `patient-${row.patient_id}`,
          patientUserId: row.patient_id,
          label: row.profiles?.name ?? 'Patient',
        })
      }
    }
    return Array.from(seen.values())
  }

  return []
}

// ─────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────

/**
 * File a new complaint. The complainant identity is taken from the
 * authenticated profile (passed in) — never trusted from the form.
 */
export async function createComplaint(form, profile) {
  if (!profile?.id) throw new Error('You must be logged in to file a complaint')

  const role = profile.role
  if (!ALLOWED_TARGETS[role]) {
    throw new Error('Your account type cannot file complaints')
  }
  if (!ALLOWED_TARGETS[role].includes(form.target_type)) {
    throw new Error('You are not allowed to file this type of complaint')
  }

  const subject = sanitizeInput(form.subject || '').slice(0, 150)
  const description = sanitizeInput(form.description || '').slice(0, 3000)
  if (!subject) throw new Error('Please enter a subject')
  if (!description) throw new Error('Please describe your complaint')

  // For entity-targeted complaints, a target must be selected
  if (form.target_type !== 'MANAGEMENT' && !form.target) {
    throw new Error('Please select who the complaint is against')
  }

  const payload = {
    complainant_user_id: profile.id,
    complainant_role: role,
    complainant_name: profile.name || null,
    complainant_email: profile.email || null,
    target_type: form.target_type,
    target_doctor_id: form.target?.doctorId ?? null,
    target_hospital_id: form.target?.hospitalId ?? null,
    target_patient_user_id: form.target?.patientUserId ?? null,
    target_name: form.target_type === 'MANAGEMENT'
      ? 'Website Management'
      : (form.target?.label ?? null),
    category: form.category || 'OTHER',
    subject,
    description,
    status: 'OPEN',
  }

  const { data, error } = await supabase
    .from('complaints')
    .insert([payload])
    .select()
    .single()
  if (error) throw error
  return data
}

// ─────────────────────────────────────────────
// Track (complainant)
// ─────────────────────────────────────────────

export async function getMyComplaints(userId) {
  const { data, error } = await supabase
    .from('complaints')
    .select('*')
    .eq('complainant_user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// ─────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────

export async function getAllComplaints(filters = {}) {
  let query = supabase
    .from('complaints')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters.status && filters.status !== 'ALL') query = query.eq('status', filters.status)
  if (filters.target_type) query = query.eq('target_type', filters.target_type)
  if (filters.complainant_role) query = query.eq('complainant_role', filters.complainant_role)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function getComplaintStats() {
  const { data, error } = await supabase.from('complaints').select('status')
  if (error) throw error
  const stats = { total: data?.length ?? 0, open: 0, under_review: 0, resolved: 0, rejected: 0, action_taken: 0 }
  for (const row of data ?? []) {
    switch (row.status) {
      case 'OPEN': stats.open++; break
      case 'UNDER_REVIEW': stats.under_review++; break
      case 'RESOLVED': stats.resolved++; break
      case 'REJECTED': stats.rejected++; break
      case 'ACTION_TAKEN': stats.action_taken++; break
    }
  }
  return stats
}

/**
 * Update a complaint's status / notes / recorded action (admin only).
 */
export async function updateComplaintStatus(id, { status, adminNotes, actionTaken }, adminId) {
  const updates = {}
  if (status) updates.status = status
  if (adminNotes !== undefined) updates.admin_notes = adminNotes
  if (actionTaken !== undefined) updates.action_taken = actionTaken
  if (status === 'RESOLVED' || status === 'REJECTED' || status === 'ACTION_TAKEN') {
    updates.resolved_by = adminId
    updates.resolved_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('complaints')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
