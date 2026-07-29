# MediBook Features Documentation

Comprehensive guide to all features in the hospital appointment and management system.

## Table of Contents

- [Core Features](#core-features)
- [Advanced Features](#advanced-features)
  - [Smart Swap Slot Exchange](#smart-swap-slot-exchange)
  - [Live Queue & ETA Tracking](#live-queue--eta-tracking)
  - [Multi-Factor Authentication (MFA/TOTP)](#multi-factor-authentication-mfatotp)
  - [Freed Slots & Waitlist](#freed-slots--waitlist)
  - [Medical History Vault](#medical-history-vault)
  - [Hospital Reviews & Ratings](#hospital-reviews--ratings)
- [Security Features](#security-features)

---

## Core Features

### Authentication & Role-Based Access
- **Four roles:** Patient, Doctor, Hospital, Admin
- **OAuth providers:** Google, GitHub (via Supabase Auth)
- **Email verification** required for account activation
- **Password reset** with secure token-based flow
- **Session management** with auto-refresh

### Appointment Booking
- **Race-safe slot reservation** using unique database constraints
- **Atomic booking** - concurrent requests for same slot guaranteed to have exactly one winner
- **Doctor availability** configurable by day of week, time range, and slot duration
- **Timezone-aware validation** - slots in the past (same day, earlier time) are automatically filtered
- **Appointment lifecycle:** PENDING → CONFIRMED → COMPLETED or CANCELLED

### Doctor Search & Discovery
- Search by name, specialization, or department
- Filter by hospital and availability
- View doctor profiles with ratings, experience, and consultation fees
- Real-time availability calendar

### Real-time Messaging
- **Patient ↔ Doctor 1:1 chat** with message history
- Doctors can toggle "accepting new patients" to control chat requests
- Realtime message delivery via Supabase subscriptions
- Message sanitization for security

### Notifications
- **In-app notifications** (real-time via Supabase Realtime)
- **Email notifications** for critical events
- **Notification types:**
  - Appointment booked/confirmed/cancelled/completed
  - 24-hour and 1-hour reminders
  - Chat messages
  - Slot available (waitlist)
  - Queue ETA shifts
  - Swap matched
  - Payment requests
  - System announcements

### AI Assistant
- **Patient query assistant** powered by NVIDIA NIM (Llama 3.1 70B)
- **Guided appointment booking** through conversational interface
- **Complaint submission** assistance
- **Contact form** routing
- Context-aware responses with access to doctor/slot availability

---

## Advanced Features

### Smart Swap Slot Exchange

**Problem solved:** Patients hold slots they don't urgently need while others wait weeks in pain. No-shows and cancellations create scheduling gaps.

**Solution:** A decentralized, anonymous peer-to-peer slot marketplace.

#### How It Works

1. **Offering a Slot (Giver)**
   - Patient has an upcoming appointment they don't urgently need
   - Clicks "Offer for Swap" in My Appointments
   - Creates an `OPEN` offer with optional note
   - Eligibility: active (PENDING/CONFIRMED), future, unpaid slot

2. **Discovery (Taker)**
   - Patient visits the Swap Market (`/patient/swaps`)
   - Sees **only** offers where:
     - Same doctor as one of their appointments
     - Offer slot is **earlier** than their current slot
     - Both slots are active and unpaid
   - System suggests which of their slots to trade

3. **Anonymous Matching**
   - Offers display doctor, date, time, and discount percentage
   - **Never reveals** the offerer's identity (RLS enforced)
   - Discovery is unidirectional: taker finds giver, not vice versa

4. **The Atomic Swap**
   - Taker clicks "Take earlier slot"
   - System uses per-doctor advisory lock to serialize
   - **Patient IDs are swapped** between the two appointments (slots stay fixed)
   - Giver's new (later) appointment gets `swap_discount_percent` = 10%
   - Both parties receive `SWAP_MATCHED` notifications
   - Other open offers on those appointments are auto-expired

5. **The Reward**
   - When doctor requests payment, the giver's co-pay is reduced by the discount %
   - Applied server-side in `request_appointment_payment` RPC
   - Minimum ₹1 (100 paise) floor

#### Technical Details

- **Migration:** `033_smart_swap.sql`
- **Table:** `slot_swap_offers`
- **RPCs:** `create_swap_offer`, `cancel_swap_offer`, `list_swap_offers`, `accept_swap_offer`
- **Service:** `src/services/swap.js`
- **UI:** `src/pages/patient/SwapMarket.jsx`
- **Concurrency:** Per-doctor advisory locks prevent race conditions
- **Anonymity:** RLS + anonymized discovery function

---

### Live Queue & ETA Tracking

**Problem solved:** Patients waiting in clinic don't know how long they'll wait, leading to frustration and walkouts.

**Solution:** Real-time queue position and ETA estimation with SMS notifications.

#### How It Works

1. **Queue Position**
   - System tracks all `CONFIRMED` appointments for today, ordered by slot time
   - RPC `get_my_queue_position` returns your position (e.g., "You are #3")
   - Updates in real-time as appointments complete or cancel

2. **ETA Calculation**
   - `estimate_my_eta` calculates wait time based on:
     - Average consultation duration (from doctor's history)
     - Number of people ahead
     - Current time vs scheduled slot time
   - Returns estimated wait in minutes

3. **Live Updates**
   - `LiveEtaCard` component in patient dashboard
   - Polls queue position and ETA every 30 seconds
   - Visual progress bar and countdown timer

4. **Shift Notifications**
   - Edge function `queue-eta-notifier` (cron job, every 5 minutes)
   - Detects significant ETA changes (>15 minutes earlier or >30 minutes later)
   - Sends SMS via Twilio and in-app `QUEUE_ETA_SHIFT` notification
   - Prevents notification spam with cooldown tracking

5. **Doctor Queue View**
   - Doctors see their queue on `DoctorQueue.jsx`
   - Can mark patients as "Called" or complete appointments
   - Queue updates propagate to waiting patients instantly

#### Technical Details

- **Migration:** `032_live_queue_eta.sql`
- **Tables:** `queue_positions`, `queue_eta_notifications`
- **RPCs:** `get_my_queue_position`, `estimate_my_eta`, `mark_patient_called`
- **Service:** `src/services/queue.js`
- **Edge Function:** `supabase/functions/queue-eta-notifier/index.ts`
- **UI:** `src/components/LiveEtaCard.jsx`, `src/pages/doctor/DoctorQueue.jsx`

---

### Multi-Factor Authentication (MFA/TOTP)

**Problem solved:** Password-only authentication is vulnerable to phishing and credential stuffing.

**Solution:** Time-based one-time passwords (TOTP) with recovery codes.

#### How It Works

1. **Enrollment**
   - Patient/Doctor navigates to Security Settings
   - Clicks "Enable MFA"
   - System generates TOTP secret via `enroll_totp` RPC
   - QR code displayed (scan with Google Authenticator, Authy, etc.)
   - User enters 6-digit code to confirm enrollment
   - `verify_totp` RPC validates and activates MFA

2. **Recovery Codes**
   - 10 single-use recovery codes generated via `generate_recovery_codes`
   - Bcrypt-hashed before storage (never stored plaintext)
   - User must download/print codes securely
   - Can regenerate codes (invalidates old ones)

3. **Login Flow**
   - User enters email/password
   - System checks if MFA enabled → redirects to `/mfa-challenge`
   - User enters TOTP code or recovery code
   - Supabase validates and issues AAL2 (Authentication Assurance Level 2) session

4. **AAL2 Gating**
   - Sensitive operations (view medical records, payments, account closure) require AAL2
   - Middleware checks `auth.current_session_aal()` in RLS policies
   - If user has MFA but session is AAL1, they're prompted to re-verify

5. **Admin MFA Reset**
   - Admins can reset a user's MFA via `admin_mfa_reset` edge function
   - Unenrolls all factors and clears recovery codes
   - Audit logged with admin ID and reason
   - User receives email notification

#### Technical Details

- **Migrations:** `027_mfa_recovery_codes.sql`, `028_mfa_aal2_gating.sql`
- **Tables:** `mfa_recovery_codes`, `mfa_reset_audit`
- **RPCs:** `enroll_totp`, `verify_totp`, `generate_recovery_codes`, `use_recovery_code`
- **Edge Functions:** `admin-mfa-reset`, `mfa-recovery-reset`
- **Service:** `src/services/mfa.js`
- **UI:** `src/pages/auth/MfaSetup.jsx`, `src/pages/SecuritySettings.jsx`

---

### Freed Slots & Waitlist

**Problem solved:** Doctor finishes an appointment early (e.g., 09:00-09:30 slot ends at 09:15), leaving 15 minutes unused. Meanwhile, other patients wait days for slots.

**Solution:** Leftover time is released as a bookable "freed slot" and offered to waitlisted patients.

#### How It Works

1. **Early Completion**
   - Doctor clicks "Complete Appointment" before slot end time
   - `complete_appointment_early` RPC:
     - Marks appointment `COMPLETED`
     - Records actual end time
     - If `actual_end < scheduled_end`, inserts `freed_slots` row for the gap

2. **Waitlist**
   - Patients can join waitlist for a doctor+date via `join_waitlist`
   - Idempotent (unique constraint prevents duplicates)
   - Waitlist persists until patient books or date passes

3. **Notifications**
   - All waitlisted patients for that doctor+date receive `SLOT_AVAILABLE` notification
   - Includes freed slot details (start/end time)

4. **Booking Freed Slots**
   - Patient views freed slots via `getOpenFreedSlots`
   - Clicks "Book" → `book_freed_slot` RPC
   - Race-safe: if two patients book same freed slot, only one succeeds
   - Creates normal appointment with `PENDING` status

5. **Expiry**
   - Freed slots older than 24 hours are auto-hidden (query filter)
   - No cleanup job needed (expired rows ignored)

#### Technical Details

- **Migration:** `018_freed_slots.sql`
- **Table:** `freed_slots`, `waitlist`
- **RPCs:** `complete_appointment_early`, `book_freed_slot`, `join_waitlist`
- **Service:** `src/services/appointments.js` (extends)
- **UI:** Integrated into appointment completion and booking flows

---

### Medical History Vault

**Problem solved:** Patients carry physical files, lose reports, and doctors lack context for informed decisions.

**Solution:** Secure, encrypted document storage with granular, per-appointment consent.

#### How It Works

1. **Upload Documents**
   - Patient uploads files (PDF, JPEG, PNG) via `MedicalHistory.jsx`
   - **5 categories:** Blood tests, Imaging, Prescriptions, Discharge summaries, Other
   - **3 files per category** limit (enforced client + server)
   - Files stored in Supabase Storage bucket `medical-documents`
   - Metadata in `medical_history` table

2. **Health Summary**
   - Patient can write a free-text summary (allergies, chronic conditions, surgeries)
   - Stored in `profiles.health_summary`
   - Always visible to doctors (with consent)

3. **Consent Model**
   - By default, doctors **cannot** see documents
   - When booking appointment, patient can "Share medical history"
   - Creates `medical_history_access` record linked to appointment
   - Consent is **per-appointment** (doctor A can't see what patient shared with doctor B)
   - Patient can revoke consent anytime

4. **Doctor View**
   - In `DoctorPatients.jsx`, doctor sees "View Medical History" button
   - RLS checks `medical_history_access` → only shows consented documents
   - Doctor can download files and view health summary

5. **Audit Logging**
   - Every access logged in `medical_record_audit` (migration 021)
   - Tracks: who, what, when, which appointment
   - Patient can view access log in Security Settings

#### Technical Details

- **Migration:** `019_medical_history.sql`, `021_medical_record_audit.sql`
- **Tables:** `medical_history`, `medical_history_access`, `medical_record_audit`
- **Storage Bucket:** `medical-documents` (RLS enforced, private)
- **Service:** `src/services/medicalHistory.js`
- **UI:** `src/pages/patient/MedicalHistory.jsx`, doctor patient detail pages

---

### Hospital Reviews & Ratings

**Problem solved:** Patients lack transparency into hospital quality and experience.

**Solution:** Verified reviews with star ratings, moderation, and aggregated scores.

#### How It Works

1. **Review Submission**
   - Patient with **completed** appointment at a hospital can review
   - `submit_hospital_review` RPC enforces:
     - One review per patient per hospital
     - Must have completed appointment
     - Rating 1-5 stars
     - Optional text review
   - Review initially `PENDING` (moderation queue)

2. **Moderation**
   - Admin reviews in `AdminDashboard` → Reviews section
   - Can approve, reject, or flag inappropriate content
   - Rejected reviews include reason (sent to patient as notification)

3. **Display**
   - `HospitalDiscovery.jsx` shows average rating + review count
   - Hospital detail page lists approved reviews
   - Sorting: newest first, highest rated, lowest rated

4. **Place Reviews Integration**
   - Migration `030_place_reviews.sql` adds Google Places integration
   - Pulls external reviews (Google, Yelp) via API
   - Displays alongside internal reviews
   - Clearly labeled as "Google Reviews" vs "Patient Reviews"

#### Technical Details

- **Migrations:** `029_hospital_reviews.sql`, `030_place_reviews.sql`
- **Tables:** `hospital_reviews`, `place_reviews`
- **RPCs:** `submit_hospital_review`, `moderate_review`
- **Service:** `src/services/reviews.js`, `src/services/places.js`
- **UI:** `src/components/HospitalDiscovery.jsx`, admin review moderation pages

---

## Security Features

### Authentication Hardening

#### Pwned Password Check (Migration 023)
- Integrates with Have I Been Pwned API
- Checks if password appears in known data breaches
- Warns user during registration/password reset
- Client-side implementation: `src/security/pwnedPassword.js`
- Uses k-anonymity (only first 5 hash chars sent to API)

#### Rate Limiting (Migration 023)
- Per-user rate limits on sensitive operations:
  - Login attempts: 5 per 15 minutes
  - Password reset: 3 per hour
  - MFA verification: 10 per 5 minutes
- Per-IP rate limits on public endpoints:
  - Forgot password: 10 per hour
  - Registration: 5 per 10 minutes
- Implemented via `rate_limit` table + RLS policies

#### CAPTCHA (Migration 031)
- hCaptcha integration on:
  - Registration
  - Login (after 3 failed attempts)
  - Forgot password
- Client component: `src/components/Captcha.jsx`
- Server validation in edge functions
- Invisible CAPTCHA for low-friction UX

### Data Protection

#### PII Encryption (Migration 024)
- Sensitive profile fields encrypted at rest:
  - Phone numbers
  - Addresses
  - Emergency contact info
- Postgres `pgcrypto` extension for encryption
- Encryption key stored in Supabase secrets (never in code)

#### Row Level Security (RLS)
- **Every table** has RLS enabled
- Users can only:
  - Read their own profile
  - Read/write their own appointments (patients)
  - Read/write appointments they're assigned to (doctors)
  - Admins have elevated access (explicitly granted)
- Medical records: multi-layer RLS (patient owns, doctor needs consent)

#### Input Sanitization
- All user input sanitized before DB insert
- HTML tags stripped to prevent XSS
- SQL injection prevented via parameterized queries
- Service layer: `src/security/sanitize.js`
- Validators: `src/security/validators.js`

### Audit Logging

- **Medical record access** (migration 021): who, what, when
- **Account closures** (migration 016): reason, timestamp, data retention
- **MFA resets** (migration 027): admin ID, reason, user notified
- **Payment transactions** (migration 022): amount, status, timestamp
- All audit tables write-only for users, read-only for admins

### Pentest Hardening (Migration 031)

Based on security assessment findings:

1. **Stored XSS Prevention**
   - All user-generated content sanitized on write
   - CSP headers configured (Vercel deployment)

2. **CSRF Protection**
   - Supabase Auth handles CSRF tokens automatically
   - All state-changing operations require authenticated session

3. **Clickjacking Prevention**
   - `X-Frame-Options: DENY` header
   - `frame-ancestors 'none'` in CSP

4. **SQL Injection Hardening**
   - All queries use parameterized RPCs
   - Dynamic SQL banned (linted)

5. **Session Fixation Prevention**
   - Session IDs regenerated on login
   - Supabase Auth best practices followed

6. **Information Disclosure**
   - Generic error messages (no stack traces to client)
   - Detailed logs only server-side

---

## Feature Roadmap

### Planned Features

- [ ] **Video consultations** - WebRTC integration for teleconsults
- [ ] **Prescription management** - Digital prescriptions with pharmacy integration
- [ ] **Lab results integration** - Pull lab reports via HL7/FHIR
- [ ] **Insurance verification** - Real-time eligibility checks
- [ ] **Multi-language support** - i18n for regional languages
- [ ] **Mobile apps** - React Native for iOS/Android

### Experimental Features

- [ ] **AI symptom checker** - Pre-consultation triage
- [ ] **Predictive no-show prevention** - ML model to identify high-risk appointments
- [ ] **Dynamic pricing** - Surge/off-peak slot pricing

---

## Related Documentation

- [Architecture](./ARCHITECTURE.md) - System design and technical decisions
- [Security](./SECURITY.md) - Comprehensive security guide
- [API Reference](./API.md) - RPC and endpoint documentation
- [Deployment](./DEPLOYMENT.md) - Production deployment guide
