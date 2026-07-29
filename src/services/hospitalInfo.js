import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────
// File Validation Constants for Hospital
// ─────────────────────────────────────────────

export const HOSPITAL_FILE_CONSTRAINTS = {
  photo: {
    maxSize: 2 * 1024 * 1024, // 2MB
    maxSizeLabel: '2MB',
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
    label: 'JPG, PNG, WebP',
    minWidth: 400,
    minHeight: 300,
    maxPhotos: 2,
  },
  document: {
    maxSize: 5 * 1024 * 1024, // 5MB
    maxSizeLabel: '5MB',
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
    label: 'PDF, JPG, PNG, WebP',
  },
}

export const MAX_HOSPITALS_PER_DOCTOR = 3

// ─────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────

/**
 * Validate a hospital photo file.
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateHospitalPhoto(file) {
  if (!file) return { valid: false, error: 'No file selected' }

  const constraints = HOSPITAL_FILE_CONSTRAINTS.photo
  if (file.size > constraints.maxSize) {
    return {
      valid: false,
      error: `Photo must be under ${constraints.maxSizeLabel}. Your file is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`,
    }
  }

  if (!constraints.allowedTypes.includes(file.type)) {
    return { valid: false, error: `Invalid format. Allowed: ${constraints.label}` }
  }

  return { valid: true }
}

/**
 * Validate hospital photo dimensions (returns a Promise).
 */
export function validateHospitalPhotoDimensions(file) {
  return new Promise((resolve) => {
    if (!file || !file.type.startsWith('image/')) {
      resolve({ valid: false, error: 'Not an image file' })
      return
    }
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      const { minWidth, minHeight } = HOSPITAL_FILE_CONSTRAINTS.photo
      if (img.width < minWidth || img.height < minHeight) {
        resolve({
          valid: false,
          error: `Image must be at least ${minWidth}×${minHeight}px. Yours is ${img.width}×${img.height}px.`,
        })
      } else {
        resolve({ valid: true })
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      resolve({ valid: false, error: 'Could not read image file' })
    }
    img.src = URL.createObjectURL(file)
  })
}

/**
 * Validate a hospital document file.
 */
export function validateHospitalDocument(file) {
  if (!file) return { valid: false, error: 'No file selected' }

  const constraints = HOSPITAL_FILE_CONSTRAINTS.document
  if (file.size > constraints.maxSize) {
    return {
      valid: false,
      error: `Document must be under ${constraints.maxSizeLabel}. Your file is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`,
    }
  }

  if (!constraints.allowedTypes.includes(file.type)) {
    return { valid: false, error: `Invalid format. Allowed: ${constraints.label}` }
  }

  return { valid: true }
}

/**
 * Validate a URL string.
 */
export function validateWebsiteUrl(url) {
  if (!url) return { valid: true } // optional field
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
// CRUD Operations
// ─────────────────────────────────────────────

/**
 * Get all hospitals for a doctor.
 * @param {number} doctorId - Doctor record ID
 * @returns {Promise<Array>}
 */
export async function getHospitalsByDoctorId(doctorId) {
  const { data, error } = await supabase
    .from('doctor_hospitals')
    .select('*')
    .eq('doctor_id', doctorId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

/**
 * Get a single hospital by ID.
 */
export async function getHospitalById(hospitalId) {
  const { data, error } = await supabase
    .from('doctor_hospitals')
    .select('*')
    .eq('id', hospitalId)
    .single()

  if (error) throw error
  return data
}

/**
 * Create a new hospital record for a doctor.
 * Enforces the max 3 hospitals limit.
 */
export async function createHospital(doctorId, hospitalData) {
  // Check limit
  const existing = await getHospitalsByDoctorId(doctorId)
  if (existing.length >= MAX_HOSPITALS_PER_DOCTOR) {
    throw new Error(`You can add a maximum of ${MAX_HOSPITALS_PER_DOCTOR} hospitals. Please remove one to add a new one.`)
  }

  const { data, error } = await supabase
    .from('doctor_hospitals')
    .insert([{
      doctor_id: doctorId,
      hospital_name: hospitalData.hospital_name,
      hospital_type: hospitalData.hospital_type || null,
      hospital_summary: hospitalData.hospital_summary || null,
      bed_count: hospitalData.bed_count || null,
      registration_number: hospitalData.registration_number || null,
      address: hospitalData.address || null,
      city: hospitalData.city || null,
      state: hospitalData.state || null,
      pincode: hospitalData.pincode || null,
      latitude: hospitalData.latitude || null,
      longitude: hospitalData.longitude || null,
      phone: hospitalData.phone || null,
      email: hospitalData.email || null,
      website_url: hospitalData.website_url || null,
    }])
    .select()
    .single()

  if (error) {
    if (error.message?.includes('idx_doctor_hospitals_unique_name')) {
      throw new Error('A hospital with this name already exists for your profile.')
    }
    throw error
  }
  return data
}

/**
 * Update an existing hospital record.
 */
export async function updateHospital(hospitalId, updates) {
  const { data, error } = await supabase
    .from('doctor_hospitals')
    .update({
      hospital_name: updates.hospital_name,
      hospital_type: updates.hospital_type || null,
      hospital_summary: updates.hospital_summary || null,
      bed_count: updates.bed_count || null,
      registration_number: updates.registration_number || null,
      address: updates.address || null,
      city: updates.city || null,
      state: updates.state || null,
      pincode: updates.pincode || null,
      latitude: updates.latitude || null,
      longitude: updates.longitude || null,
      phone: updates.phone || null,
      email: updates.email || null,
      website_url: updates.website_url || null,
    })
    .eq('id', hospitalId)
    .select()
    .single()

  if (error) {
    if (error.message?.includes('idx_doctor_hospitals_unique_name')) {
      throw new Error('A hospital with this name already exists for your profile.')
    }
    throw error
  }
  return data
}

/**
 * Delete a hospital record and its associated files.
 */
export async function deleteHospital(hospitalId) {
  // Get hospital to clean up files
  const hospital = await getHospitalById(hospitalId)

  // Delete photos from storage
  const photoPaths = [hospital.photo_1_url, hospital.photo_2_url].filter(Boolean)
  if (photoPaths.length > 0) {
    await supabase.storage.from('hospital-photos').remove(photoPaths)
  }

  // Delete document from storage
  if (hospital.document_url) {
    await supabase.storage.from('hospital-docs').remove([hospital.document_url])
  }

  // Delete the record
  const { error } = await supabase
    .from('doctor_hospitals')
    .delete()
    .eq('id', hospitalId)

  if (error) throw error
}

// ─────────────────────────────────────────────
// Photo Upload / Delete
// ─────────────────────────────────────────────

/**
 * Upload a hospital photo to storage.
 * @param {File} file - The photo file
 * @param {number} doctorId - Doctor ID (for path namespacing)
 * @param {number} hospitalId - Hospital record ID
 * @param {1|2} slot - Photo slot (1 or 2)
 * @returns {Promise<string>} Storage path
 */
export async function uploadHospitalPhoto(file, doctorId, hospitalId, slot) {
  // Validate
  const validation = validateHospitalPhoto(file)
  if (!validation.valid) throw new Error(validation.error)

  const dimValidation = await validateHospitalPhotoDimensions(file)
  if (!dimValidation.valid) throw new Error(dimValidation.error)

  const timestamp = Date.now()
  const ext = file.name.split('.').pop()
  const path = `doctor_${doctorId}/hospital_${hospitalId}/${timestamp}_photo_${slot}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('hospital-photos')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (uploadError) throw uploadError

  // Update the hospital record with the photo path
  const updateField = slot === 1 ? 'photo_1_url' : 'photo_2_url'
  const { error: updateError } = await supabase
    .from('doctor_hospitals')
    .update({ [updateField]: path })
    .eq('id', hospitalId)

  if (updateError) throw updateError

  return path
}

/**
 * Delete a hospital photo from storage and clear the DB field.
 */
export async function deleteHospitalPhoto(hospitalId, slot) {
  const hospital = await getHospitalById(hospitalId)
  const photoPath = slot === 1 ? hospital.photo_1_url : hospital.photo_2_url

  if (photoPath) {
    await supabase.storage.from('hospital-photos').remove([photoPath])
  }

  const updateField = slot === 1 ? 'photo_1_url' : 'photo_2_url'
  const { error } = await supabase
    .from('doctor_hospitals')
    .update({ [updateField]: null })
    .eq('id', hospitalId)

  if (error) throw error
}

/**
 * Get the public URL of a hospital photo.
 */
export function getHospitalPhotoUrl(path) {
  if (!path) return null
  const { data } = supabase.storage.from('hospital-photos').getPublicUrl(path)
  return data?.publicUrl || null
}

// ─────────────────────────────────────────────
// Document Upload / Download
// ─────────────────────────────────────────────

/**
 * Upload a supporting document for a hospital.
 */
export async function uploadHospitalDocument(file, doctorId, hospitalId) {
  const validation = validateHospitalDocument(file)
  if (!validation.valid) throw new Error(validation.error)

  const timestamp = Date.now()
  const ext = file.name.split('.').pop()
  const path = `doctor_${doctorId}/hospital_${hospitalId}/${timestamp}_document.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('hospital-docs')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (uploadError) throw uploadError

  // Update hospital record
  const { error: updateError } = await supabase
    .from('doctor_hospitals')
    .update({ document_url: path })
    .eq('id', hospitalId)

  if (updateError) throw updateError

  return path
}

/**
 * Delete a hospital document from storage and clear the DB field.
 */
export async function deleteHospitalDocument(hospitalId) {
  const hospital = await getHospitalById(hospitalId)

  if (hospital.document_url) {
    await supabase.storage.from('hospital-docs').remove([hospital.document_url])
  }

  const { error } = await supabase
    .from('doctor_hospitals')
    .update({ document_url: null })
    .eq('id', hospitalId)

  if (error) throw error
}

/**
 * Get a signed download URL for a hospital document.
 */
export async function getHospitalDocumentUrl(documentPath) {
  if (!documentPath) return null

  const { data, error } = await supabase.storage
    .from('hospital-docs')
    .createSignedUrl(documentPath, 3600) // 1 hour expiry

  if (error) {
    console.error('Error generating signed URL:', error)
    return null
  }
  return data?.signedUrl || null
}
