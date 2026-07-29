// chat-assistant Edge Function
// Proxies chat requests to NVIDIA NIM API securely.
// Supports: context-aware medical chat, appointment booking actions, and AI writing mode.
//
// Security:
//   • "Verify JWT" is enabled in Supabase, so the platform rejects requests
//     without a valid user token before this code runs.
//   • We additionally derive the user id from the token to enforce a
//     best-effort per-user rate limit and tie usage to a real account.
//   • CORS is restricted to the origins listed in the ALLOWED_ORIGINS secret
//     (comma-separated). If unset, it falls back to '*' so local dev keeps
//     working — set it in production to lock the endpoint to your domain.

// Origins allowed to call this function from a browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || ''
  let allowOrigin = '*'
  if (ALLOWED_ORIGINS.length > 0) {
    allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

// Decode a base64url segment (JWT payload) without external deps.
function b64urlDecode(segment: string): string {
  let s = segment.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4
  if (pad) s += '='.repeat(4 - pad)
  return atob(s)
}

// Extract the Supabase user id (sub) from the bearer token.
// The platform already verified the signature (Verify JWT); we only read it.
function getUserId(req: Request): string | null {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token || token.split('.').length !== 3) return null
  try {
    const payload = JSON.parse(b64urlDecode(token.split('.')[1]))
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

// ── Best-effort per-user rate limiting (per isolate, sliding window) ──
const RL_WINDOW_MS = 60_000   // 1 minute window
const RL_MAX_REQUESTS = 20    // max messages per window per user
const rlBuckets = new Map<string, number[]>()

function isRateLimited(userId: string): boolean {
  const now = Date.now()
  // Light periodic prune to keep the map bounded
  if (rlBuckets.size > 5000) rlBuckets.clear()
  const recent = (rlBuckets.get(userId) || []).filter((t) => now - t < RL_WINDOW_MS)
  if (recent.length >= RL_MAX_REQUESTS) {
    rlBuckets.set(userId, recent)
    return true
  }
  recent.push(now)
  rlBuckets.set(userId, recent)
  return false
}

// Base system prompt — extended dynamically with patient/doctor context
const BASE_SYSTEM_PROMPT = `You are MediBook AI, a friendly and knowledgeable medical assistant embedded in the MediBook hospital management system.

You help patients with:
- Understanding symptoms and when to seek medical care
- Explaining medical terms in simple language
- Guiding users on how to book appointments with the right specialist
- Providing general healthcare and wellness advice
- Booking appointments with doctors on the platform

IMPORTANT RULES:
- Always recommend users consult a licensed doctor for diagnosis and treatment.
- Keep responses concise and easy to understand.
- Do NOT provide specific diagnoses.
- If in doubt, always advise the user to visit a doctor.
- When listing items, use numbered lists (1. 2. 3.) and **bold** for key terms.`

const BOOKING_INSTRUCTIONS = `
APPOINTMENT BOOKING:
When the user wants to book an appointment, guide them step by step:
1. Ask which specialization they need (or suggest based on their symptoms)
2. Show available doctors from the AVAILABLE DOCTORS list
3. Ask for preferred date
4. Once all details are confirmed, respond with a structured action block:

\`\`\`action
{"type":"BOOK_APPOINTMENT","doctor_id":<number>,"doctor_name":"<name>","specialization":"<spec>","date":"<YYYY-MM-DD>","slot":"<HH:MM>","fee":<number>}
\`\`\`

NEVER emit the action block without the user explicitly confirming the doctor, date, and time.
Only suggest doctors from the AVAILABLE DOCTORS list below.`

const WRITE_SYSTEM_PROMPT = `You are a professional writing assistant. Write clear, warm, and concise text as requested. Return ONLY the text — no explanations, no quotes, no markdown headers. Keep it natural and conversational.`

/**
 * Complaint / message-to-management guidance, tailored to the user's role.
 */
function buildSupportInstructions(role: string | null): string {
  const allowed: Record<string, string> = {
    PATIENT: 'a DOCTOR, a HOSPITAL, or website MANAGEMENT',
    DOCTOR: 'a HOSPITAL, a PATIENT you have treated, or website MANAGEMENT',
    HOSPITAL: 'a DOCTOR affiliated with you, or website MANAGEMENT',
  }
  const scope = allowed[role || ''] || 'website MANAGEMENT'

  return `

COMPLAINTS & MESSAGES TO MANAGEMENT:
This user is a ${role || 'USER'} and may file a complaint against ${scope}, or send a general message to website management.

To FILE A COMPLAINT: collect the target, a category, a short subject, and a clear description. For a doctor or hospital target, you MUST use a numeric ID taken from the lists above — never invent one. After the user EXPLICITLY confirms, output exactly:
\`\`\`action
{"type":"FILE_COMPLAINT","target_type":"DOCTOR|HOSPITAL|PATIENT|MANAGEMENT","target_id":<number or null>,"target_name":"<name or null>","category":"BEHAVIOUR|PAYMENT|SERVICE_QUALITY|MISCONDUCT|FACILITY|NEGLIGENCE|MANAGEMENT|OTHER","subject":"<short>","description":"<details>"}
\`\`\`
Use target_id:null and target_name:null when target_type is MANAGEMENT.

To SEND A MESSAGE TO MANAGEMENT (feedback, query, or general contact): collect a subject and message, confirm, then output exactly:
\`\`\`action
{"type":"MESSAGE_MANAGEMENT","subject":"<short>","message":"<details>"}
\`\`\`

RULES: Never emit an action block before the user explicitly confirms the details. Never invent IDs or target someone outside the allowed scope. The system re-validates everything before saving.`
}

/**
 * Build chat context SERVER-SIDE from the authenticated user's own data.
 *
 * The Supabase client is scoped to the caller's JWT, so Row Level Security
 * guarantees we only ever read this user's profile/appointments — the
 * browser never sends (or can spoof) this data, and PII is minimized to
 * just what the assistant needs (first name, gender, age, appointment
 * summary, and the public doctor directory).
 */
async function buildServerContext(req: Request): Promise<any> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
  const context: any = { patient: null, appointments: [], doctors: [], hospitals: [] }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return context

  const authHeader = req.headers.get('Authorization') || ''
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  try {
    const { data: auth } = await sb.auth.getUser()
    const userId = auth?.user?.id
    if (!userId) return context

    // Minimal profile — first name, gender, derived age (NOT DOB/address/blood group)
    const { data: profile } = await sb
      .from('profiles')
      .select('name, gender, date_of_birth, role')
      .eq('id', userId)
      .single()

    if (profile) {
      context.patient = {
        name: profile.name ? String(profile.name).split(' ')[0] : null,
        gender: profile.gender || null,
        age: computeAge(profile.date_of_birth),
        role: profile.role,
      }
    }

    // Appointment summary (no free-text "reason" — that can hold sensitive details)
    const { data: appts } = await sb
      .from('appointments')
      .select(`appointment_date, slot_start_time, status, doctors (specialization, consultation_fee, profiles:user_id (name))`)
      .eq('patient_id', userId)
      .order('appointment_date', { ascending: false })
      .limit(10)

    if (appts) {
      context.appointments = appts.map((a: any) => ({
        date: a.appointment_date,
        time: a.slot_start_time,
        status: a.status,
        doctor_name: a.doctors?.profiles?.name || 'Unknown',
        specialization: a.doctors?.specialization || 'General',
        fee: a.doctors?.consultation_fee,
      }))
    }

    // Public doctor directory for booking suggestions
    const { data: docs } = await sb
      .from('doctors')
      .select(`id, specialization, consultation_fee, experience_years, profiles:user_id (name)`)
      .eq('is_active', true)
      .order('experience_years', { ascending: false })
      .limit(20)

    if (docs) {
      context.doctors = docs.map((d: any) => ({
        id: d.id,
        name: d.profiles?.name || 'Doctor',
        specialization: d.specialization,
        fee: d.consultation_fee,
        experience: d.experience_years,
      }))
    }

    // Public hospital directory (for info + hospital-targeted complaints)
    const { data: hosps } = await sb
      .from('hospitals')
      .select('id, name, city')
      .eq('is_active', true)
      .order('name')
      .limit(15)

    if (hosps) {
      context.hospitals = hosps.map((h: any) => ({ id: h.id, name: h.name, city: h.city }))
    }
  } catch (_e) {
    // Non-fatal — the assistant still works without context, just less personalized.
  }

  return context
}

function computeAge(dob: string | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000))
  return age >= 0 && age < 130 ? age : null
}

/**
 * Build a dynamic system prompt with patient context and doctor data.
 */
function buildSystemPrompt(context: any): string {
  let prompt = BASE_SYSTEM_PROMPT

  if (!context) return prompt

  // Patient context
  if (context.patient) {
    const p = context.patient
    prompt += `\n\nPATIENT CONTEXT:`
    if (p.name) prompt += `\n- Name: ${p.name}`
    if (p.gender) prompt += `\n- Gender: ${p.gender}`
    if (p.age != null) prompt += `\n- Age: ${p.age}`
  }

  // Appointment history
  if (context.appointments?.length > 0) {
    prompt += `\n\nAPPOINTMENT HISTORY:`
    const upcoming = context.appointments.filter((a: any) => ['PENDING', 'CONFIRMED'].includes(a.status))
    const past = context.appointments.filter((a: any) => a.status === 'COMPLETED')
    const cancelled = context.appointments.filter((a: any) => a.status === 'CANCELLED')

    if (upcoming.length > 0) {
      prompt += `\nUpcoming:`
      upcoming.forEach((a: any) => {
        prompt += `\n- Dr. ${a.doctor_name} (${a.specialization}) on ${a.date} at ${a.time} [${a.status}]`
      })
    }
    if (past.length > 0) {
      prompt += `\nCompleted: ${past.length} appointment(s)`
    }
    if (cancelled.length > 0) {
      prompt += `\nCancelled: ${cancelled.length} appointment(s)`
    }
  }

  // Available doctors for booking
  if (context.doctors?.length > 0) {
    prompt += BOOKING_INSTRUCTIONS
    prompt += `\n\nAVAILABLE DOCTORS:`
    context.doctors.forEach((d: any) => {
      prompt += `\n- ID:${d.id} | Dr. ${d.name} — ${d.specialization}, ₹${d.fee || 'N/A'}, ${d.experience || '?'}yr exp`
    })
  }

  // Hospital directory (for info + hospital-targeted complaints)
  if (context.hospitals?.length > 0) {
    prompt += `\n\nHOSPITALS:`
    context.hospitals.forEach((h: any) => {
      prompt += `\n- ID:${h.id} | ${h.name}${h.city ? ` (${h.city})` : ''}`
    })
  }

  // Complaints & message-to-management guidance (role-aware)
  prompt += buildSupportInstructions(context.patient?.role || null)

  return prompt
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Identify the caller from the (already platform-verified) JWT.
  const userId = getUserId(req)
  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'Authentication required. Please log in again.' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Best-effort per-user rate limit to protect the AI quota from abuse.
  if (isRateLimited(userId)) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Please slow down and try again shortly.' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { messages, writeMode } = body

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid messages format. Expected a non-empty array.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate and sanitize messages
    const sanitizedMessages = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({
        role: m.role,
        content: String(m.content || '').slice(0, 4000),
      }))

    if (sanitizedMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid messages provided.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = Deno.env.get('NVIDIA_API_KEY')
    if (!apiKey) {
      console.error('NVIDIA_API_KEY is not set in Supabase Secrets')
      return new Response(
        JSON.stringify({ error: 'AI service is not configured. Please contact support.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Choose system prompt based on mode.
    // Context is built SERVER-SIDE from the verified user — never trusted from
    // the client — so PII stays out of the browser payload and can't be spoofed.
    const systemPrompt = writeMode
      ? WRITE_SYSTEM_PROMPT
      : buildSystemPrompt(await buildServerContext(req))

    const payload = {
      model: 'meta/llama-3.3-70b-instruct',
      messages: [{ role: 'system', content: systemPrompt }, ...sanitizedMessages],
      temperature: writeMode ? 0.8 : 0.7,
      top_p: 0.95,
      max_tokens: writeMode ? 512 : 2048,
      stream: true,
    }

    console.log(`[chat-assistant] user=${userId} mode=${writeMode ? 'write' : 'chat'}, msgs=${sanitizedMessages.length}`)

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[chat-assistant] NVIDIA API error: status=${response.status} body=${errText}`)
      return new Response(
        JSON.stringify({
          error: `AI service returned error ${response.status}. Please try again.`,
          details: Deno.env.get('ENVIRONMENT') === 'development' ? errText : undefined,
        }),
        {
          status: response.status >= 500 ? 502 : response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('[chat-assistant] Unhandled error:', error?.message || error)
    return new Response(
      JSON.stringify({ error: error?.message || 'An unexpected error occurred.' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
