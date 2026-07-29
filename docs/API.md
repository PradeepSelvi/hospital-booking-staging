# MediBook API Reference

Complete reference for all RPC functions, endpoints, and API patterns in the hospital booking system.

## Table of Contents

- [API Overview](#api-overview)
- [Authentication](#authentication)
- [Appointments](#appointments)
- [Smart Swap](#smart-swap)
- [Queue & ETA](#queue--eta)
- [Medical History](#medical-history)
- [MFA/TOTP](#mfatotp)
- [Payments](#payments)
- [Chat & Messaging](#chat--messaging)
- [Reviews & Ratings](#reviews--ratings)
- [Admin Functions](#admin-functions)
- [Error Codes](#error-codes)

---

## API Overview

### Architecture

MediBook uses **Supabase** which provides:
1. **PostgREST API** - Auto-generated REST endpoints from database schema
2. **RPC Functions** - Custom Postgres functions exposed as endpoints
3. **Realtime** - WebSocket subscriptions for live updates

### Base URL

```
https://your-project-ref.supabase.co
```

### Authentication

All API calls require authentication via JWT token in `Authorization` header:

```
Authorization: Bearer <supabase-jwt-token>
```

Obtain token via Supabase Auth SDK:
```javascript
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123'
})
const token = data.session.access_token
```

### Request Format

**RPC calls:**
```http
POST /rest/v1/rpc/function_name
Content-Type: application/json
Authorization: Bearer <token>

{
  "param1": "value1",
  "param2": "value2"
}
```

**Direct table queries:**
```http
GET /rest/v1/table_name?column=eq.value
Authorization: Bearer <token>
```

### Response Format

```json
{
  "data": { ... },
  "error": null
}
```

Or in case of error:
```json
{
  "data": null,
  "error": {
    "message": "Error description",
    "code": "P0001",
    "details": "..."
  }
}
```

---

## Authentication

### Sign Up

**Endpoint:** Supabase Auth API  
**Method:** `supabase.auth.signUp()`

```javascript
const { data, error } = await supabase.auth.signUp({
  email: 'patient@example.com',
  password: 'securePass123!',
  options: {
    data: {
      name: 'John Doe',
      role: 'PATIENT'
    }
  }
})
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "patient@example.com",
    "email_confirmed_at": null
  },
  "session": {
    "access_token": "jwt-token",
    "refresh_token": "refresh-token"
  }
}
```

### Sign In

```javascript
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'patient@example.com',
  password: 'securePass123!'
})
```

### OAuth Sign In

```javascript
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: 'https://yourdomain.com/auth/callback'
  }
})
```

**Supported Providers:**
- Google
- GitHub


---

## Appointments

### book_appointment

Book a new appointment with race-safe slot reservation.

**Function:** `public.book_appointment(p_doctor_id, p_date, p_start_time, p_reason)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_doctor_id` | BIGINT | Yes | Doctor's ID |
| `p_date` | DATE | Yes | Appointment date (YYYY-MM-DD) |
| `p_start_time` | TIME | Yes | Slot start time (HH:MM) |
| `p_reason` | TEXT | No | Reason for visit (max 500 chars) |

**Auth:** Requires authenticated user (patient)

**Example:**
```javascript
const { data, error } = await supabase.rpc('book_appointment', {
  p_doctor_id: 42,
  p_date: '2026-02-15',
  p_start_time: '10:00',
  p_reason: 'Annual checkup'
})
```

**Response:**
```json
{
  "id": 123,
  "patient_id": "uuid",
  "doctor_id": 42,
  "appointment_date": "2026-02-15",
  "slot_start_time": "10:00:00",
  "slot_end_time": "10:30:00",
  "status": "PENDING",
  "reason": "Annual checkup",
  "created_at": "2026-01-10T12:00:00Z"
}
```

**Errors:**
- `P0001` - Appointment in the past
- `P0001` - Time slot has already passed (same-day check)
- `P0001` - Doctor not found or inactive
- `P0002` - Slot already booked (unique constraint violation)
- `28000` - Not authenticated

**Rate Limit:** None (slot availability is the limiting factor)

---

### cancel_appointment

Cancel an existing appointment.

**Function:** `public.cancel_appointment(p_appointment_id)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_appointment_id` | BIGINT | Yes | Appointment ID to cancel |

**Auth:** Requires patient (owner) or admin

**Example:**
```javascript
const { data, error } = await supabase.rpc('cancel_appointment', {
  p_appointment_id: 123
})
```

**Response:**
```json
{
  "id": 123,
  "status": "CANCELLED",
  "updated_at": "2026-01-10T14:30:00Z"
}
```

**Errors:**
- `P0001` - Appointment not found
- `42501` - Not authorized (not owner/admin)
- `P0001` - Already completed/cancelled

---

### complete_appointment_early

Complete an appointment (doctor only) and release freed slot if early.

**Function:** `public.complete_appointment_early(p_appointment_id, p_consultation_notes)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_appointment_id` | BIGINT | Yes | Appointment ID |
| `p_consultation_notes` | TEXT | No | Doctor's notes/prescription |

**Auth:** Requires doctor (assigned to appointment)

**Example:**
```javascript
const { data, error } = await supabase.rpc('complete_appointment_early', {
  p_appointment_id: 123,
  p_consultation_notes: 'Patient stable. Prescribed paracetamol 500mg.'
})
```

**Response:**
```json
{
  "freed_slot_id": 456,
  "slot_start": "10:15:00",
  "slot_end": "10:30:00",
  "notified_count": 3
}
```

Or `null` if no freed slot (completed at scheduled time).

**Errors:**
- `P0001` - Appointment not found
- `42501` - Not the assigned doctor
- `P0001` - Not in CONFIRMED status

---

### book_freed_slot

Book a freed slot (leftover time from early completion).

**Function:** `public.book_freed_slot(p_freed_slot_id, p_reason)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_freed_slot_id` | BIGINT | Yes | Freed slot ID |
| `p_reason` | TEXT | No | Reason for visit |

**Auth:** Requires patient

**Example:**
```javascript
const { data, error } = await supabase.rpc('book_freed_slot', {
  p_freed_slot_id: 456,
  p_reason: 'Follow-up consultation'
})
```

**Response:**
```json
{
  "id": 789,
  "appointment_date": "2026-02-15",
  "slot_start_time": "10:15:00",
  "slot_end_time": "10:30:00",
  "status": "PENDING"
}
```

**Errors:**
- `P0001` - Freed slot not found or already taken
- `P0002` - Race condition - someone else booked first


---

## Smart Swap

### create_swap_offer

Offer an appointment slot for peer-to-peer exchange.

**Function:** `public.create_swap_offer(p_appointment_id, p_note)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_appointment_id` | BIGINT | Yes | Your appointment ID to offer |
| `p_note` | TEXT | No | Optional note for takers |

**Auth:** Requires patient (owner of appointment)

**Requirements:**
- Appointment must be PENDING or CONFIRMED
- Must be in the future
- Must NOT be already paid

**Example:**
```javascript
const { data, error } = await supabase.rpc('create_swap_offer', {
  p_appointment_id: 123,
  p_note: 'Non-urgent, happy to move to later slot'
})
```

**Response:**
```json
{
  "id": 10,
  "appointment_id": 123,
  "offered_by": "uuid",
  "doctor_id": 42,
  "offer_date": "2026-02-15",
  "offer_slot_start": "10:00:00",
  "discount_percent": 10,
  "status": "OPEN",
  "created_at": "2026-01-10T15:00:00Z"
}
```

**Errors:**
- `P0001` - Appointment not found or not yours
- `P0001` - Only active appointments can be offered
- `P0001` - Appointment in the past
- `P0001` - Already paid (cannot swap)

---

### list_swap_offers

List available swap offers (anonymized, eligibility-filtered).

**Function:** `public.list_swap_offers()`

**Parameters:** None

**Auth:** Requires authenticated patient

**Returns:** Only offers where:
- You have a LATER appointment with the same doctor
- Your appointment is active and unpaid
- Offer is OPEN and not yours

**Example:**
```javascript
const { data, error } = await supabase.rpc('list_swap_offers')
```

**Response:**
```json
[
  {
    "offer_id": 10,
    "doctor_id": 42,
    "doctor_name": "Dr. Sarah Smith",
    "specialization": "Cardiology",
    "offer_date": "2026-02-15",
    "offer_slot_start": "10:00:00",
    "discount_percent": 10,
    "note": "Non-urgent, happy to move",
    "my_appointment_id": 456,
    "my_appointment_date": "2026-02-20",
    "my_slot_start": "14:00:00"
  }
]
```

**Note:** Offerer's identity is NEVER exposed.

---

### accept_swap_offer

Accept a swap offer (atomic patient_id exchange).

**Function:** `public.accept_swap_offer(p_offer_id, p_taker_appointment_id)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_offer_id` | BIGINT | Yes | Offer ID to accept |
| `p_taker_appointment_id` | BIGINT | Yes | Your appointment ID to trade |

**Auth:** Requires patient

**Validation:**
- Offer must be OPEN
- Both appointments must be active, unpaid, same doctor
- Your appointment must be LATER than offered slot

**Example:**
```javascript
const { data, error } = await supabase.rpc('accept_swap_offer', {
  p_offer_id: 10,
  p_taker_appointment_id: 456
})
```

**Response:**
```json
{
  "id": 10,
  "status": "COMPLETED",
  "matched_appointment_id": 456,
  "matched_at": "2026-01-10T15:30:00Z"
}
```

**Side Effects:**
- Appointment 123 → patient_id changes to yours
- Appointment 456 → patient_id changes to offerer's, gets `swap_discount_percent: 10`
- Both parties receive `SWAP_MATCHED` notification
- Other open offers on these appointments are expired

**Errors:**
- `P0001` - Offer not found
- `P0002` - Offer no longer available (race condition)
- `42501` - Can only swap using your own appointment
- `P0001` - Your appointment is not later
- `P0001` - One appointment already paid

---

### cancel_swap_offer

Withdraw an open swap offer.

**Function:** `public.cancel_swap_offer(p_offer_id)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_offer_id` | BIGINT | Yes | Your offer ID |

**Auth:** Requires patient (offer owner)

**Example:**
```javascript
const { data, error } = await supabase.rpc('cancel_swap_offer', {
  p_offer_id: 10
})
```

**Response:**
```json
{
  "id": 10,
  "status": "CANCELLED",
  "updated_at": "2026-01-10T16:00:00Z"
}
```

**Errors:**
- `P0001` - Offer not found
- `42501` - Not your offer
- `P0001` - Offer not OPEN (already completed/cancelled)


---

## Queue & ETA

### get_my_queue_position

Get your position in today's queue for a doctor.

**Function:** `public.get_my_queue_position(p_doctor_id)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_doctor_id` | BIGINT | Yes | Doctor ID |

**Auth:** Requires patient with today's appointment

**Example:**
```javascript
const { data, error } = await supabase.rpc('get_my_queue_position', {
  p_doctor_id: 42
})
```

**Response:**
```json
{
  "position": 3,
  "total_ahead": 2,
  "my_slot_start": "14:00:00",
  "current_time": "13:45:00"
}
```

**Errors:**
- `P0001` - No appointment for today with this doctor

---

### estimate_my_eta

Estimate wait time based on queue position and average consultation duration.

**Function:** `public.estimate_my_eta(p_doctor_id)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_doctor_id` | BIGINT | Yes | Doctor ID |

**Auth:** Requires patient

**Example:**
```javascript
const { data, error } = await supabase.rpc('estimate_my_eta', {
  p_doctor_id: 42
})
```

**Response:**
```json
{
  "estimated_wait_minutes": 45,
  "queue_position": 3,
  "average_duration_minutes": 15,
  "estimated_call_time": "14:30:00"
}
```

**Calculation:**
```
wait = (people_ahead * avg_duration) + max(0, current_time - my_slot_time)
```

---

## Medical History

### grant_medical_access

Grant doctor access to medical records for specific appointment.

**Function:** `public.grant_medical_access(p_appointment_id)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_appointment_id` | BIGINT | Yes | Appointment ID |

**Auth:** Requires patient (owner)

**Example:**
```javascript
const { data, error } = await supabase.rpc('grant_medical_access', {
  p_appointment_id: 123
})
```

**Response:**
```json
{
  "id": 50,
  "patient_id": "uuid",
  "doctor_id": 42,
  "appointment_id": 123,
  "granted": true,
  "granted_at": "2026-01-10T16:00:00Z"
}
```

**Side Effect:** Doctor can now view patient's medical documents.

---

### revoke_medical_access

Revoke doctor's access to medical records.

**Function:** `public.revoke_medical_access(p_appointment_id)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_appointment_id` | BIGINT | Yes | Appointment ID |

**Auth:** Requires patient (owner)

**Example:**
```javascript
const { data, error } = await supabase.rpc('revoke_medical_access', {
  p_appointment_id: 123
})
```

**Response:**
```json
{
  "id": 50,
  "granted": false,
  "revoked_at": "2026-01-10T17:00:00Z"
}
```

---

## MFA/TOTP

### enroll_totp

Generate TOTP secret for MFA enrollment.

**Function:** `public.enroll_totp()`

**Parameters:** None

**Auth:** Requires authenticated user

**Example:**
```javascript
const { data, error } = await supabase.rpc('enroll_totp')
```

**Response:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qr_uri": "otpauth://totp/MediBook:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=MediBook"
}
```

**Next Steps:**
1. Display QR code using `qr_uri`
2. User scans with authenticator app
3. User enters 6-digit code
4. Call `verify_totp` to confirm enrollment

---

### verify_totp

Verify TOTP code to complete enrollment or challenge.

**Function:** Supabase Auth SDK

```javascript
// Enrollment verification
const { data, error } = await supabase.auth.mfa.verify({
  factorId: '<factor-id>',
  challengeId: '<challenge-id>',
  code: '123456'
})
```

**Response:**
```json
{
  "access_token": "jwt-with-aal2",
  "user": { ... }
}
```

---

### generate_recovery_codes

Generate 10 single-use recovery codes.

**Function:** `public.generate_recovery_codes()`

**Parameters:** None

**Auth:** Requires user with MFA enabled

**Example:**
```javascript
const { data, error } = await supabase.rpc('generate_recovery_codes')
```

**Response:**
```json
[
  "A1B2C3D4E5F6G7H8",
  "I9J0K1L2M3N4O5P6",
  ...
]
```

**Warning:** Codes shown ONCE. User must save securely.


---

## Payments

### request_appointment_payment

Doctor requests payment for completed appointment.

**Function:** `public.request_appointment_payment(p_appointment_id, p_amount_paise)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_appointment_id` | BIGINT | Yes | Appointment ID |
| `p_amount_paise` | BIGINT | Yes | Amount in paise (₹1 = 100 paise) |

**Auth:** Requires doctor (assigned to appointment)

**Example:**
```javascript
const { data, error } = await supabase.rpc('request_appointment_payment', {
  p_appointment_id: 123,
  p_amount_paise: 50000  // ₹500.00
})
```

**Response:**
```json
{
  "id": 789,
  "appointment_id": 123,
  "patient_id": "uuid",
  "doctor_id": 42,
  "amount_paise": 45000,
  "status": "PENDING",
  "created_at": "2026-01-10T18:00:00Z"
}
```

**Note:** `amount_paise` reduced if appointment has `swap_discount_percent`:
```
actual_amount = requested_amount * (100 - discount_percent) / 100
```

**Errors:**
- `P0001` - Appointment not found
- `42501` - Not the assigned doctor
- `P0001` - Cannot request payment for cancelled appointment

---

### pay_appointment_offline

Record offline payment (cash at clinic).

**Function:** `public.pay_appointment_offline(p_payment_id)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_payment_id` | BIGINT | Yes | Payment ID |

**Auth:** Requires doctor or admin

**Example:**
```javascript
const { data, error } = await supabase.rpc('pay_appointment_offline', {
  p_payment_id: 789
})
```

**Response:**
```json
{
  "id": 789,
  "status": "PAID",
  "payment_method": "OFFLINE",
  "paid_at": "2026-01-10T18:30:00Z"
}
```

**Side Effect:** Appointment status → COMPLETED

---

## Chat & Messaging

### create_conversation

Create or get existing 1:1 conversation between patient and doctor.

**Function:** Direct table insert via PostgREST (RLS enforced)

```javascript
const { data, error } = await supabase
  .from('conversations')
  .insert({
    patient_id: '<patient-uuid>',
    doctor_id: 42
  })
  .select()
  .single()
```

**Response:**
```json
{
  "id": 100,
  "patient_id": "uuid",
  "doctor_id": 42,
  "last_message_at": null,
  "created_at": "2026-01-10T19:00:00Z"
}
```

**Note:** Unique constraint prevents duplicates. If exists, returns existing.

---

### send_message

Send a chat message.

**Function:** Direct table insert

```javascript
const { data, error } = await supabase
  .from('chat_messages')
  .insert({
    conversation_id: 100,
    sender_id: '<your-uuid>',
    content: 'Hello doctor, I have a question about my prescription.'
  })
  .select()
  .single()
```

**Response:**
```json
{
  "id": 500,
  "conversation_id": 100,
  "sender_id": "uuid",
  "content": "Hello doctor...",
  "read": false,
  "created_at": "2026-01-10T19:05:00Z"
}
```

**Side Effect:** `conversations.last_message_at` updated

---

### mark_messages_read

Mark all messages in conversation as read.

**Function:** Direct table update

```javascript
const { data, error } = await supabase
  .from('chat_messages')
  .update({ read: true })
  .eq('conversation_id', 100)
  .eq('sender_id', '<other-user-id>')  // Not my messages
```

---

## Reviews & Ratings

### submit_hospital_review

Submit a review for a hospital (verified patients only).

**Function:** `public.submit_hospital_review(p_hospital_id, p_rating, p_review_text)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_hospital_id` | BIGINT | Yes | Hospital ID |
| `p_rating` | INT | Yes | Rating 1-5 stars |
| `p_review_text` | TEXT | No | Review text (max 1000 chars) |

**Auth:** Requires patient with completed appointment at this hospital

**Example:**
```javascript
const { data, error } = await supabase.rpc('submit_hospital_review', {
  p_hospital_id: 10,
  p_rating: 5,
  p_review_text: 'Excellent service and clean facilities!'
})
```

**Response:**
```json
{
  "id": 200,
  "hospital_id": 10,
  "patient_id": "uuid",
  "rating": 5,
  "review_text": "Excellent service...",
  "status": "PENDING",
  "created_at": "2026-01-10T20:00:00Z"
}
```

**Status:** Initially `PENDING`, awaits admin moderation.

**Errors:**
- `P0001` - No completed appointments at this hospital
- `P0001` - Already reviewed this hospital
- `P0001` - Rating must be 1-5


---

## Admin Functions

### admin_mfa_reset

Admin resets a user's MFA (unenroll all factors + delete recovery codes).

**Edge Function:** `/functions/v1/admin-mfa-reset`

**Method:** POST

**Parameters:**
```json
{
  "targetUserId": "uuid-of-user",
  "reason": "User lost authenticator device"
}
```

**Auth:** Requires admin role

**Example:**
```javascript
const { data, error } = await fetch(
  'https://your-project.supabase.co/functions/v1/admin-mfa-reset',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      targetUserId: 'target-uuid',
      reason: 'Lost device'
    })
  }
)
```

**Response:**
```json
{
  "success": true,
  "message": "MFA reset successful"
}
```

**Side Effects:**
- All TOTP factors unenrolled
- Recovery codes deleted
- Audit log entry created
- User notified via email

---

### moderate_review

Admin approves/rejects a hospital review.

**Function:** `public.moderate_review(p_review_id, p_action, p_reason)`

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_review_id` | BIGINT | Yes | Review ID |
| `p_action` | TEXT | Yes | 'APPROVE' or 'REJECT' |
| `p_reason` | TEXT | No | Reason (required for REJECT) |

**Auth:** Requires admin

**Example:**
```javascript
const { data, error } = await supabase.rpc('moderate_review', {
  p_review_id: 200,
  p_action: 'APPROVE',
  p_reason: null
})
```

**Response:**
```json
{
  "id": 200,
  "status": "APPROVED",
  "moderated_by": "admin-uuid",
  "moderated_at": "2026-01-11T10:00:00Z"
}
```

**Side Effect:** If rejected, patient receives notification with reason.

---

## Error Codes

### Postgres Error Codes

| Code | Description | Example |
|------|-------------|---------|
| `P0001` | Business logic error | "Appointment in the past" |
| `P0002` | Concurrent modification | "Slot just booked by someone else" |
| `P0003` | Resource limit | "Slot capacity full" |
| `23505` | Unique constraint violation | Duplicate entry |
| `28000` | Authentication required | Not logged in |
| `42501` | Authorization failed | Not owner/wrong role |

### HTTP Status Codes

| Status | Meaning | When |
|--------|---------|------|
| 200 | Success | RPC executed successfully |
| 400 | Bad Request | Invalid parameters |
| 401 | Unauthorized | Missing/invalid JWT |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Concurrent modification (race condition) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server/database error |

### Custom Error Messages

**Format:**
```json
{
  "error": {
    "message": "Human-readable error",
    "code": "P0001",
    "details": "Additional context",
    "hint": "Suggested action"
  }
}
```

**Example:**
```json
{
  "error": {
    "message": "This time slot has already passed. Please pick a later slot.",
    "code": "P0001",
    "details": "Requested: 09:00, Current: 21:00 IST",
    "hint": "Slots are validated in Asia/Kolkata timezone"
  }
}
```

---

## Rate Limits

### Global Limits

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| RPC calls | 100 req/min | Per user |
| Table queries (SELECT) | 200 req/min | Per user |
| Table mutations (INSERT/UPDATE) | 50 req/min | Per user |
| Storage uploads | 10 files/min | Per user |
| Realtime connections | 5 concurrent | Per user |

### Function-Specific Limits

| Function | Limit | Window | Enforced |
|----------|-------|--------|----------|
| `book_appointment` | 10 | 1 hour | Database |
| `create_swap_offer` | 5 | 1 hour | Database |
| `submit_hospital_review` | 3 | 24 hours | Database |
| Login attempts | 5 | 15 min | Database + CAPTCHA |
| MFA verification | 10 | 5 min | Database |

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1704070800
```

---

## Real-time Subscriptions

### Subscribe to Notifications

```javascript
const channel = supabase
  .channel('notifications')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'notifications',
    filter: `user_id=eq.${user.id}`
  }, (payload) => {
    console.log('New notification:', payload.new)
    showToast(payload.new.title, payload.new.body)
  })
  .subscribe()
```

**Cleanup:**
```javascript
supabase.removeChannel(channel)
```

### Subscribe to Chat Messages

```javascript
const channel = supabase
  .channel('chat')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'chat_messages',
    filter: `conversation_id=eq.${conversationId}`
  }, (payload) => {
    addMessageToUI(payload.new)
  })
  .subscribe()
```

### Subscribe to Queue Updates

```javascript
const channel = supabase
  .channel('queue')
  .on('postgres_changes', {
    event: '*',  // INSERT, UPDATE, DELETE
    schema: 'public',
    table: 'queue_positions',
    filter: `doctor_id=eq.${doctorId}`
  }, (payload) => {
    refreshQueuePosition()
  })
  .subscribe()
```

---

## SDK Examples

### JavaScript/TypeScript (Web)

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

// Book appointment
async function bookAppointment(doctorId, date, time, reason) {
  const { data, error } = await supabase.rpc('book_appointment', {
    p_doctor_id: doctorId,
    p_date: date,
    p_start_time: time,
    p_reason: reason
  })
  
  if (error) throw new Error(error.message)
  return data
}
```

### Python (Backend/Scripts)

```python
from supabase import create_client

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
)

# Admin operation (with service role key)
response = supabase.rpc(
    "moderate_review",
    {
        "p_review_id": 200,
        "p_action": "APPROVE",
        "p_reason": None
    }
).execute()
```

---

## Versioning

**Current API Version:** v1

**Version Header:**
```
Accept: application/vnd.api+json; version=1
```

**Deprecation Policy:**
- Breaking changes require new version
- Old versions supported for 6 months
- Deprecation announced 3 months in advance

---

## Related Documentation

- [Features Guide](./FEATURES.md) - User-facing feature descriptions
- [Security Guide](./SECURITY.md) - Authentication, RLS policies, audit logging
- [Architecture Guide](./ARCHITECTURE.md) - RPC pattern, concurrency model
- [Deployment Guide](./DEPLOYMENT.md) - Production setup

---

**Last Updated:** January 2026  
**API Version:** 1.0  
**Migration Version:** 034
