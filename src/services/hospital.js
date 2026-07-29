import { supabase } from '../lib/supabase'
import { sanitizeFormData, sanitizeSearchTerm } from '../security/sanitize'

// ─────────────────────────────────────────────
// File Validation Constants
// ─────────────────────────────────────────────

export const HOSPITAL_PHOTO_CONSTRAINTS = {
  maxSize: 2 * 1024 * 1024, // 2MB
  maxSizeLabel: '2MB',
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  label: 'JPG, PNG, WebP',
  minWidth: 400,
  minHeight: 300,
  maxPhotos: 10,
}

export const HOSPITAL_DOC_CONSTRAINTS = {
  maxSize: 5 * 1024 * 1024, // 5MB
  maxSizeLabel: '5MB',
  allowedTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
  label: 'PDF, JPG, PNG, WebP',
}

const PHOTO_BUCKET = 'hospital-photos'
const DOC_BUCKET = 'hospital-docs'

// ─────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────

export function validatePhotoFile(file) {
  if (!file) return { valid: false, error: 'No file selected' }
  if (file.size > HOSPITAL_PHOTO_CONSTRAINTS.maxSize) {
    return {
      valid: false,
      error: `Photo must be under ${HOSPITAL_PHOTO_CONSTRAINTS.maxSizeLabel}. Your file is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`,
    }
  }
  if (!HOSPITAL_PHOTO_CONSTRAINTS.allowedTypes.includes(file.type)) {
    return { valid: false, error: `Invalid format. Allowed: ${HOSPITAL_PHOTO_CONSTRAINTS.label}` }
  }
  return { valid: true }
}

export function validateDocFile(file) {
  if (!file) return { valid: false, error: 'No file selected' }
  if (file.size > HOSPITAL_DOC_CONSTRAINTS.maxSize) {
    return {
      valid: false,
      error: `Document must be under ${HOSPITAL_DOC_CONSTRAINTS.maxSizeLabel}. Your file is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`,
    }
  }
  if (!HOSPITAL_DOC_CONSTRAINTS.allowedTypes.includes(file.type)) {
    return { valid: false, error: `Invalid format. Allowed: ${HOSPITAL_DOC_CONSTRAINTS.label}` }
  }
  return { valid: true }
}

export function validateWebsiteUrl(url) {
  if (!url) return { valid: true }
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must start with http:// or https://' }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Please enter a valid URL (e.g. https://example.com)' }
  }
}

// ─────────────────────────────────────────────
// Hospital CRUD
// ─────────────────────────────────────────────

/**
 * Fetch the hospital owned by the logged-in hospital user.
 * Returns null if none exists.
 */
export async function getHospitalByOwnerId(userId) {
  const { data, error } = await supabase
    .from('hospitals')
    .select('*')
    .eq('owner_user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Fetch a single hospital by ID.
 */
export async function getHospitalById(id) {
  const { data, error } = await supabase
    .from('hospitals')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

// Public, display-safe hospital columns. Owner id, registration number and
// private contact internals are excluded from the public directory/search.
const PUBLIC_HOSPITAL_SELECT =
  'id, name, type, address, city, state, pincode, phone, website, summary_text, cover_photo_url, is_verified'

/**
 * List active hospitals with optional search/filter.
 * @param {Object} filters - { search, city, type }
 */
export async function getAllHospitals(filters = {}) {
  let query = supabase
    .from('hospitals')
    .select(PUBLIC_HOSPITAL_SELECT)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (filters.type) query = query.eq('type', filters.type)
  if (filters.city) {
    const city = sanitizeSearchTerm(filters.city)
    if (city) query = query.ilike('city', `%${city}%`)
  }
  if (filters.search) {
    const term = sanitizeSearchTerm(filters.search)
    if (term) {
      // term is sanitized of commas/parens/wildcards so it cannot alter the
      // PostgREST filter grammar (filter-injection safe).
      query = query.or(`name.ilike.%${term}%,city.ilike.%${term}%`)
    }
  }

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

/**
 * Update hospital profile fields (basic info + location).
 */
export async function updateHospitalProfile(id, updates) {
  const clean = sanitizeFormData({
    name: updates.name,
    type: updates.type || null,
    registration_number: updates.registration_number || null,
    bed_count: updates.bed_count ? parseInt(updates.bed_count) : null,
    address: updates.address || null,
    city: updates.city || null,
    state: updates.state || null,
    pincode: updates.pincode || null,
    phone: updates.phone || null,
    email: updates.email || null,
    website: updates.website || null,
  })
  // Coordinates are numeric — keep them out of text sanitization
  clean.latitude = updates.latitude ? parseFloat(updates.latitude) : null
  clean.longitude = updates.longitude ? parseFloat(updates.longitude) : null

  const { data, error } = await supabase
    .from('hospitals')
    .update(clean)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Update only the text summary.
 */
export async function updateHospitalSummary(id, summaryText) {
  const { data, error } = await supabase
    .from('hospitals')
    .update({ summary_text: summaryText || null })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Compute a rough profile completion percentage (0-100).
 */
export function computeProfileCompletion(hospital) {
  if (!hospital) return 0
  const fields = [
    hospital.name, hospital.type, hospital.address, hospital.city,
    hospital.state, hospital.pincode, hospital.phone, hospital.email,
    hospital.latitude, hospital.summary_text, hospital.cover_photo_url,
  ]
  const filled = fields.filter(v => v !== null && v !== undefined && `${v}`.trim() !== '').length
  return Math.round((filled / fields.length) * 100)
}

// ─────────────────────────────────────────────
// Summary Document (hospital-docs bucket, private)
// ─────────────────────────────────────────────

export async function uploadHospitalSummaryDoc(file, hospitalId) {
  const validation = validateDocFile(file)
  if (!validation.valid) throw new Error(validation.error)

  const timestamp = Date.now()
  const ext = file.name.split('.').pop()
  const path = `hospital_${hospitalId}/${timestamp}_summary.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(DOC_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (uploadError) throw uploadError

  const { error: updateError } = await supabase
    .from('hospitals')
    .update({ summary_doc_url: path })
    .eq('id', hospitalId)
  if (updateError) throw updateError

  return path
}

export async function deleteHospitalSummaryDoc(hospitalId) {
  const hospital = await getHospitalById(hospitalId)
  if (hospital.summary_doc_url) {
    await supabase.storage.from(DOC_BUCKET).remove([hospital.summary_doc_url])
  }
  const { error } = await supabase
    .from('hospitals')
    .update({ summary_doc_url: null })
    .eq('id', hospitalId)
  if (error) throw error
}

export async function getSummaryDocUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(DOC_BUCKET)
    .createSignedUrl(path, 3600)
  if (error) {
    console.error('Error generating signed URL:', error)
    return null
  }
  return data?.signedUrl || null
}

// ─────────────────────────────────────────────
// Cover Photo (hospital-photos bucket, public)
// ─────────────────────────────────────────────

export async function uploadCoverPhoto(file, hospitalId) {
  const validation = validatePhotoFile(file)
  if (!validation.valid) throw new Error(validation.error)

  const timestamp = Date.now()
  const ext = file.name.split('.').pop()
  const path = `hospital_${hospitalId}/cover_${timestamp}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (uploadError) throw uploadError

  const { error: updateError } = await supabase
    .from('hospitals')
    .update({ cover_photo_url: path })
    .eq('id', hospitalId)
  if (updateError) throw updateError

  return path
}

// ─────────────────────────────────────────────
// Gallery Photos (hospital_photos table + hospital-photos bucket)
// ─────────────────────────────────────────────

export async function getHospitalPhotos(hospitalId) {
  const { data, error } = await supabase
    .from('hospital_photos')
    .select('*')
    .eq('hospital_id', hospitalId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function uploadHospitalPhoto(file, hospitalId, uploadedBy, caption = '') {
  const validation = validatePhotoFile(file)
  if (!validation.valid) throw new Error(validation.error)

  // Enforce gallery limit
  const existing = await getHospitalPhotos(hospitalId)
  if (existing.length >= HOSPITAL_PHOTO_CONSTRAINTS.maxPhotos) {
    throw new Error(`You can upload a maximum of ${HOSPITAL_PHOTO_CONSTRAINTS.maxPhotos} photos.`)
  }

  const timestamp = Date.now()
  const ext = file.name.split('.').pop()
  const path = `hospital_${hospitalId}/gallery_${timestamp}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (uploadError) throw uploadError

  const nextOrder = existing.length
  const { data, error } = await supabase
    .from('hospital_photos')
    .insert([{
      hospital_id: hospitalId,
      photo_url: path,
      caption: caption || null,
      display_order: nextOrder,
      uploaded_by: uploadedBy || null,
    }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteHospitalPhoto(photoId) {
  // Look up the storage path first
  const { data: photo, error: fetchError } = await supabase
    .from('hospital_photos')
    .select('photo_url')
    .eq('id', photoId)
    .single()
  if (fetchError) throw fetchError

  if (photo?.photo_url) {
    await supabase.storage.from(PHOTO_BUCKET).remove([photo.photo_url])
  }

  const { error } = await supabase
    .from('hospital_photos')
    .delete()
    .eq('id', photoId)
  if (error) throw error
}

/**
 * Persist a new ordering. Accepts an array of photo IDs in the desired order.
 */
export async function reorderHospitalPhotos(photoIds) {
  const updates = photoIds.map((id, index) =>
    supabase.from('hospital_photos').update({ display_order: index }).eq('id', id)
  )
  await Promise.all(updates)
}

export async function updatePhotoCaption(photoId, caption) {
  const { error } = await supabase
    .from('hospital_photos')
    .update({ caption: caption || null })
    .eq('id', photoId)
  if (error) throw error
}

/**
 * Public URL for a stored photo path.
 */
export function getPhotoUrl(path) {
  if (!path) return null
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return data?.publicUrl || null
}

// ─────────────────────────────────────────────
// Doctor ↔ Hospital Affiliations (self-approval flow)
// ─────────────────────────────────────────────

/**
 * Doctor self-joins a hospital. Affiliation is APPROVED immediately.
 */
export async function requestDoctorAffiliation(doctorId, hospitalId, isPrimary = false) {
  const { data, error } = await supabase
    .from('doctor_hospital_affiliations')
    .insert([{
      doctor_id: doctorId,
      hospital_id: hospitalId,
      status: 'APPROVED',
      is_primary: isPrimary,
      joined_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
    }])
    .select()
    .single()
  if (error) {
    if (error.code === '23505' || error.message?.includes('uq_doctor_hospital')) {
      throw new Error('You are already affiliated with this hospital.')
    }
    throw error
  }

  // If primary, set the shortcut column on doctors
  if (isPrimary) {
    await supabase.from('doctors').update({ hospital_id: hospitalId }).eq('id', doctorId)
  }
  return data
}

/**
 * Set a given affiliation as the doctor's primary hospital.
 */
export async function setPrimaryAffiliation(affiliationId, doctorId, hospitalId) {
  // Clear other primaries for this doctor
  await supabase
    .from('doctor_hospital_affiliations')
    .update({ is_primary: false })
    .eq('doctor_id', doctorId)

  const { error } = await supabase
    .from('doctor_hospital_affiliations')
    .update({ is_primary: true })
    .eq('id', affiliationId)
  if (error) throw error

  await supabase.from('doctors').update({ hospital_id: hospitalId }).eq('id', doctorId)
}

/**
 * List all hospitals a doctor is affiliated with (joined hospital details).
 */
export async function getDoctorAffiliations(doctorId) {
  const { data, error } = await supabase
    .from('doctor_hospital_affiliations')
    .select('*, hospitals (id, name, type, city, state, cover_photo_url)')
    .eq('doctor_id', doctorId)
    .order('joined_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * List all doctors affiliated with a hospital (joined doctor + profile details).
 */
export async function getHospitalDoctors(hospitalId) {
  const { data, error } = await supabase
    .from('doctor_hospital_affiliations')
    .select(`
      *,
      doctors (
        id, specialization, qualification, experience_years,
        consultation_fee, photo_url, is_active,
        profiles:user_id (name, email, phone, avatar_url),
        departments (name)
      )
    `)
    .eq('hospital_id', hospitalId)
    .order('joined_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Remove an affiliation (doctor leaves, or hospital removes a doctor).
 */
export async function removeAffiliation(affiliationId, doctorId = null, hospitalId = null) {
  const { error } = await supabase
    .from('doctor_hospital_affiliations')
    .delete()
    .eq('id', affiliationId)
  if (error) throw error

  // Clear the primary shortcut if it pointed at this hospital
  if (doctorId && hospitalId) {
    await supabase
      .from('doctors')
      .update({ hospital_id: null })
      .eq('id', doctorId)
      .eq('hospital_id', hospitalId)
  }
}

/**
 * Counts for the hospital dashboard.
 */
export async function getHospitalStats(hospitalId) {
  const [doctorsRes, photosRes] = await Promise.all([
    supabase
      .from('doctor_hospital_affiliations')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', hospitalId)
      .eq('status', 'APPROVED'),
    supabase
      .from('hospital_photos')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', hospitalId),
  ])

  return {
    totalDoctors: doctorsRes.count ?? 0,
    totalPhotos: photosRes.count ?? 0,
  }
}

/**
 * Total count of active hospitals (admin dashboard).
 */
export async function getActiveHospitalCount() {
  const { count, error } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
  if (error) throw error
  return count ?? 0
}

// ─────────────────────────────────────────────
// Admin — Hospital Management
// (Admins have full access via the hospitals_admin_all RLS policy)
// ─────────────────────────────────────────────

/**
 * List ALL hospitals (active + inactive) for the admin panel, with
 * owner profile info and an affiliated-doctor count.
 * @param {Object} filters - { search, city, type, status }
 *   status: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'VERIFIED' | 'UNVERIFIED'
 */
export async function getAllHospitalsAdmin(filters = {}) {
  let query = supabase
    .from('hospitals')
    .select(`
      *,
      owner:owner_user_id (name, email, phone),
      doctor_hospital_affiliations (id)
    `)
    .order('created_at', { ascending: false })

  if (filters.type) query = query.eq('type', filters.type)
  if (filters.status === 'ACTIVE') query = query.eq('is_active', true)
  if (filters.status === 'INACTIVE') query = query.eq('is_active', false)
  if (filters.status === 'VERIFIED') query = query.eq('is_verified', true)
  if (filters.status === 'UNVERIFIED') query = query.eq('is_verified', false)
  if (filters.city) {
    const city = sanitizeSearchTerm(filters.city)
    if (city) query = query.ilike('city', `%${city}%`)
  }
  if (filters.search) {
    const term = sanitizeSearchTerm(filters.search)
    if (term) {
      query = query.or(
        `name.ilike.%${term}%,city.ilike.%${term}%,registration_number.ilike.%${term}%`
      )
    }
  }

  const { data, error } = await query
  if (error) throw error

  // Flatten the affiliation count
  return (data ?? []).map(h => ({
    ...h,
    doctorCount: Array.isArray(h.doctor_hospital_affiliations)
      ? h.doctor_hospital_affiliations.length
      : 0,
  }))
}

/**
 * Aggregate counts for the admin hospitals header.
 */
export async function getHospitalAdminStats() {
  const [totalRes, activeRes, verifiedRes] = await Promise.all([
    supabase.from('hospitals').select('id', { count: 'exact', head: true }),
    supabase.from('hospitals').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('hospitals').select('id', { count: 'exact', head: true }).eq('is_verified', true),
  ])
  const total = totalRes.count ?? 0
  const active = activeRes.count ?? 0
  const verified = verifiedRes.count ?? 0
  return {
    total,
    active,
    inactive: total - active,
    verified,
    unverified: total - verified,
  }
}

/**
 * Toggle a hospital's active status (admin).
 */
export async function setHospitalActive(id, isActive) {
  const { data, error } = await supabase
    .from('hospitals')
    .update({ is_active: isActive })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Toggle a hospital's verified status (admin).
 */
export async function setHospitalVerified(id, isVerified) {
  const { data, error } = await supabase
    .from('hospitals')
    .update({ is_verified: isVerified })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Fetch the doctors affiliated with a hospital for the admin detail view.
 */
export async function getHospitalDoctorsAdmin(hospitalId) {
  return getHospitalDoctors(hospitalId)
}
