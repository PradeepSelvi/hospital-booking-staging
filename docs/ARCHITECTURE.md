# MediBook Architecture Documentation

Technical architecture, design decisions, and implementation patterns for the hospital booking system.

## Table of Contents

- [System Overview](#system-overview)
- [Technology Stack](#technology-stack)
- [Architecture Patterns](#architecture-patterns)
- [Concurrency Model](#concurrency-model)
- [Data Flow](#data-flow)
- [Security Architecture](#security-architecture)
- [Real-time Features](#real-time-features)
- [Timezone Handling](#timezone-handling)

---

## System Overview

MediBook is a full-stack hospital appointment management platform following a **serverless architecture** with Supabase as the backend-as-a-service (BaaS) provider.

### High-Level Architecture

```
┌─────────────────┐
│   Client (SPA)  │  React 18 + Vite
│   Static Host   │  (Vercel/Netlify)
└────────┬────────┘
         │ HTTPS
         ▼
┌─────────────────────────────────────────┐
│         Supabase Platform               │
│  ┌───────────┐  ┌──────────────────┐   │
│  │  PostgREST│  │  Edge Functions  │   │
│  │  (API)    │  │  (Deno Runtime)  │   │
│  └─────┬─────┘  └────────┬─────────┘   │
│        │                 │              │
│        ▼                 ▼              │
│  ┌─────────────────────────────────┐   │
│  │     PostgreSQL Database         │   │
│  │  (with RLS + custom functions)  │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌──────────┐  ┌──────────────────┐   │
│  │ Realtime │  │  Storage (S3)    │   │
│  └──────────┘  └──────────────────┘   │
└─────────────────────────────────────────┘
         │
         ▼ (external integrations)
┌──────────────────────────────────────────┐
│  Razorpay (payments)                     │
│  NVIDIA NIM (AI assistant)               │
│  Twilio (SMS notifications)              │
│  HIBP API (pwned password check)         │
└──────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend
- **Framework:** React 18 (Hooks, Context API)
- **Build Tool:** Vite 5 (fast dev server, optimized builds)
- **Router:** React Router 6 (nested routes, protected routes)
- **UI Library:** Bootstrap 5 (responsive grid, components)
- **State Management:** React Context + local state
- **Real-time:** Supabase Realtime subscriptions
- **HTTP Client:** Supabase JS SDK (wraps Fetch API)
- **Charts:** Chart.js + react-chartjs-2
- **Notifications:** react-toastify

### Backend (Supabase)
- **Database:** PostgreSQL 15.x
  - Extensions: `uuid-ossp`, `pg_cron`, `pgcrypto`, `pg_net`
- **API Layer:** PostgREST (auto-generated REST from schema)
- **Auth:** Supabase Auth (JWT-based, OAuth, MFA)
- **Storage:** S3-compatible object storage
- **Realtime:** Postgres Realtime (CDC-based pub/sub)
- **Edge Functions:** Deno runtime (TypeScript)

### External Services
- **Payments:** Razorpay (India-focused payment gateway)
- **AI/ML:** NVIDIA NIM (Llama 3.1 70B Instruct)
- **SMS:** Twilio (queue ETA notifications)
- **Email:** Supabase Auth (SMTP via SendGrid/AWS SES)
- **Security:** Have I Been Pwned API (pwned passwords)

---

## Architecture Patterns

### 1. Service Layer Pattern

All database interactions are abstracted into service modules:

```
src/services/
  ├── appointments.js    - Booking, cancellation, completion
  ├── doctors.js         - Search, profiles, availability
  ├── profiles.js        - User profile management
  ├── chat.js            - Direct messaging
  ├── medicalHistory.js  - Document upload, consent
  ├── payments.js        - Razorpay integration
  ├── swap.js            - Smart Swap marketplace
  ├── queue.js           - Live queue tracking
  ├── mfa.js             - MFA enrollment, verification
  └── ...
```

**Benefits:**
- Single source of truth for data access
- Consistent error handling
- Easy to mock for testing
- Encapsulates business logic

**Example:**
```javascript
// appointments.js
export async function bookAppointment(payload) {
  // Input sanitization
  const { doctor_id, appointment_date, slot_start_time, reason } = payload
  
  // Client-side guard (UX fast-fail)
  if (appointmentInPast(appointment_date, slot_start_time)) {
    throw new Error('Cannot book past slots')
  }
  
  // Server RPC call (single source of truth)
  const { data, error } = await supabase.rpc('book_appointment', {
    p_doctor_id: doctor_id,
    p_date: appointment_date,
    p_start_time: slot_start_time,
    p_reason: sanitizeInput(reason),
  })
  
  // Error mapping
  if (error) {
    if (error.code === '23505') {
      throw new Error('Slot already booked')
    }
    throw new Error(error.message)
  }
  
  return data
}
```

### 2. Row Level Security (RLS) Pattern

**Zero trust at database level:** All access control enforced in Postgres policies, not application code.

```sql
-- Example: Appointments RLS
CREATE POLICY "patients_select_own"
  ON appointments FOR SELECT
  USING (patient_id = auth.uid());

CREATE POLICY "doctors_select_assigned"
  ON appointments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM doctors
    WHERE id = appointments.doctor_id
      AND user_id = auth.uid()
  ));
```

**Benefits:**
- No way to bypass access control (not in app code)
- Defense in depth (even if app has bug, DB is safe)
- Policies reused across PostgREST API and RPCs

### 3. Server-Defined Functions (RPC) Pattern

Complex operations use **database functions** instead of client-side orchestration:

```sql
CREATE FUNCTION book_appointment(
  p_doctor_id BIGINT,
  p_date DATE,
  p_start_time TIME,
  p_reason TEXT
) RETURNS appointments AS $$
  -- All validation + insert in single transaction
  -- Client just calls RPC, can't tamper with logic
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Benefits:**
- **Atomic operations:** Multiple steps in single transaction
- **Security:** Business logic on server (client can't modify)
- **Performance:** No round-trips for multi-step operations
- **Reusability:** Same RPC used by web, mobile, CLI

**When to use RPCs vs direct queries:**
- **RPC:** Multi-step operations, complex validation, state changes
- **Direct query:** Simple CRUD with RLS-only access control

### 4. Edge Functions for External Integration

Long-running tasks, external API calls, and privileged operations use **Deno edge functions**:

```
supabase/functions/
  ├── chat-assistant/      - NVIDIA NIM API calls
  ├── razorpay-*/          - Payment gateway integration
  ├── send-reminders/      - Email/SMS via external services
  ├── admin-mfa-reset/     - Privileged admin operations
  └── queue-eta-notifier/  - Cron-triggered SMS alerts
```

**Benefits:**
- **Isolation:** External API credentials stay server-side
- **Async:** Don't block client on slow operations
- **Scheduled:** Can trigger via pg_cron
- **Scalable:** Auto-scale with Deno Deploy

---

## Concurrency Model

### Problem: Race Conditions in Appointment Booking

Two users clicking "Book" at the exact same moment could both see the slot as available and try to insert. Without proper handling, both would succeed → double-booking.

### Solution: Multi-Layer Concurrency Control

#### Layer 1: Unique Constraint (Hard Guard)

```sql
CREATE UNIQUE INDEX idx_appointments_active_slot
  ON appointments (doctor_id, appointment_date, slot_start_time)
  WHERE status IN ('PENDING', 'CONFIRMED');
```

**How it works:**
- Postgres enforces "exactly one active appointment per (doctor, date, time)"
- Second INSERT with same values **fails atomically** with `23505` error
- Index is partial (only active slots) to allow reusing times after cancellation

**This is the single source of truth.** No amount of app bugs can cause double-booking.

#### Layer 2: Advisory Locks (Serialization)

For operations needing read-then-write consistency (e.g., Smart Swap):

```sql
-- Lock on specific doctor (all swaps for this doctor serialize)
PERFORM pg_advisory_xact_lock(
  hashtextextended('swap:' || doctor_id::TEXT, 0)
);

-- Now safe to read two appointments, validate, then swap patient IDs
```

**How it works:**
- `pg_advisory_xact_lock` blocks concurrent transactions on same key
- Lock auto-released at transaction end
- Key is scoped (e.g., per-doctor) to allow parallel swaps for different doctors

#### Layer 3: Client-Side Optimistic Check (UX)

```javascript
// Fast-fail before even calling server
if (slotAlreadyBooked) {
  toast.error('Slot taken, pick another')
  return
}
// Submit to server (which re-validates atomically)
```

**Purpose:** Instant feedback, not security. Server is still single source of truth.

### Concurrency in Smart Swap

The swap operation is especially tricky: two appointments' `patient_id` must be swapped atomically, and only if:
1. Offer is still `OPEN`
2. Taker's slot is genuinely later
3. Neither side has been paid
4. Neither side has been cancelled/completed

**Solution:**
```sql
-- Serialize all swaps for this doctor
PERFORM pg_advisory_xact_lock(
  hashtextextended('swap:' || v_offer.doctor_id::TEXT, 0)
);

-- Re-check everything inside lock
IF v_offer.status <> 'OPEN' THEN
  RAISE EXCEPTION 'Offer no longer available';
END IF;

-- Atomic swap (both UPDATEs or neither)
UPDATE appointments SET patient_id = v_late.patient_id WHERE id = v_early.id;
UPDATE appointments SET patient_id = v_early.patient_id WHERE id = v_late.id;
```

If two takers click simultaneously:
1. First one gets the lock, completes swap
2. Second one waits, then gets lock
3. Second one sees `status = 'COMPLETED'` (first already changed it)
4. Second one gets "Offer no longer available" error

---

## Data Flow

### Appointment Booking Flow

```
┌─────────┐
│ Patient │
│  clicks │
│  "Book" │
└────┬────┘
     │
     ▼
┌────────────────────────────┐
│ bookAppointment(payload)   │  Service layer
│  - sanitize input          │
│  - client-side validation  │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ supabase.rpc('book_appt', ...) │  PostgREST API call
└────────┬───────────────────────┘
         │
         ▼
┌───────────────────────────────────┐
│ book_appointment() RPC            │  Postgres function
│  1. Check auth.uid() exists       │
│  2. Validate date not past        │
│  3. Validate time not past (IST)  │
│  4. Check doctor is active        │
│  5. Calculate slot_end_time       │
│  6. INSERT with unique constraint │
│     → Success: return appointment │
│     → 23505: "slot taken" error   │
└───────────┬───────────────────────┘
            │
            ▼
┌─────────────────────────┐
│ Appointment created     │
│  - Patient receives it  │
│  - Doctor sees in queue │
└─────────────────────────┘
```

### Payment Flow (with Settlement)

```
┌────────────────────────────────────────────┐
│ Doctor completes appointment + requests ₹X │
└───────────────┬────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────┐
│ request_appointment_payment() RPC        │
│  - Reads swap_discount_percent (if any) │
│  - Calculates: X * (100 - discount) / 100│
│  - INSERT/UPDATE payments table          │
│  - Status: PENDING                       │
└───────────────┬──────────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Patient sees "Payment Required" banner│
│  - Online (Razorpay)                  │
│  - Offline (cash)                     │
└────────┬──────────────────────────────┘
         │
         ├── ONLINE PATH ──────────────────────┐
         │                                     │
         ▼                                     │
┌────────────────────────────┐                │
│ razorpay-create-order      │                │
│  (edge function)           │                │
│  - Reads amount from DB    │                │
│  - Creates Razorpay order  │                │
│  - Returns order_id        │                │
└────────┬───────────────────┘                │
         │                                     │
         ▼                                     │
┌────────────────────────────┐                │
│ Razorpay Checkout modal    │                │
│  - Patient pays            │                │
│  - Returns razorpay_*      │                │
│    payment_id, signature   │                │
└────────┬───────────────────┘                │
         │                                     │
         ├── VERIFY PATH 1 (browser) ─────────┤
         │                                     │
         ▼                                     │
┌────────────────────────────────┐            │
│ razorpay-verify-payment        │            │
│  (edge function)               │            │
│  - Validates HMAC signature    │            │
│  - Marks payment PAID          │            │
│  - Completes appointment       │            │
└────────────────────────────────┘            │
         │                                     │
         └── VERIFY PATH 2 (webhook) ─────────┤
                                               │
                  ┌────────────────────────────┘
                  │
                  ▼
         ┌────────────────────────────────┐
         │ razorpay-webhook               │
         │  (edge function, server-to-    │
         │   server, runs even if patient │
         │   closes browser)              │
         │  - Validates webhook signature │
         │  - Idempotent: checks if       │
         │    already marked PAID         │
         │  - Completes appointment       │
         └────────────────────────────────┘
```

**Dual verification ensures:**
1. Fast path: browser verify completes payment immediately
2. Fallback: webhook catches it even if user closes tab
3. Idempotency: both can run, second is no-op

---

## Security Architecture

### Defense in Depth

```
┌────────────────────────────────────────────┐
│         Client-Side Validation             │  Layer 1: UX + early abort
│  - sanitizeInput() on all forms           │
│  - CAPTCHA on auth pages                  │
│  - Pwned password check (k-anonymity)     │
└───────────────┬────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────┐
│         Edge Function Validation           │  Layer 2: Server-side guard
│  - Re-validate all inputs                  │
│  - Rate limiting checks                    │
│  - Verify CAPTCHA server-side             │
└───────────────┬────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────┐
│      Row Level Security (RLS)              │  Layer 3: DB access control
│  - auth.uid() enforced in policies         │
│  - No direct table access without policy   │
└───────────────┬────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────┐
│      Database Constraints                  │  Layer 4: Data integrity
│  - NOT NULL, CHECK constraints             │
│  - Foreign keys with ON DELETE CASCADE     │
│  - Unique indexes (prevent duplicates)     │
└────────────────────────────────────────────┘
```

### Authentication Flow

```
┌─────────┐
│  Login  │
└────┬────┘
     │
     ▼
┌─────────────────────────┐
│ 1. Email + password     │
│    submitted            │
└────┬────────────────────┘
     │
     ▼
┌─────────────────────────┐
│ 2. Supabase Auth        │
│    - bcrypt verify      │
│    - rate limit check   │
│    - issues JWT (AAL1)  │
└────┬────────────────────┘
     │
     ├── Has MFA? ─────┐
     │  YES            │  NO
     │                 │
     ▼                 ▼
┌──────────────┐  ┌──────────────┐
│ MFA Challenge│  │ Logged in    │
│  - TOTP code │  │  (AAL1)      │
│  - Recovery  │  └──────────────┘
│    code      │
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ 3. verify_totp RPC   │
│    - Supabase verif. │
│    - Upgrades to AAL2│
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Logged in (AAL2)     │
│  - Can access MFA-   │
│    gated features    │
└──────────────────────┘
```

**AAL2-gated operations:**
- View/download medical records
- Account closure
- Admin operations
- Payment processing

---

## Real-time Features

### Supabase Realtime Architecture

Uses **Change Data Capture (CDC)** from Postgres replication log:

```
┌────────────────────┐
│  Postgres Writes   │  INSERT/UPDATE/DELETE
└─────────┬──────────┘
          │
          ▼
┌────────────────────────────────┐
│  Replication Log (WAL)         │  Write-Ahead Log
└─────────┬──────────────────────┘
          │
          ▼
┌────────────────────────────────┐
│  Supabase Realtime Server      │  Parses WAL, filters by RLS
└─────────┬──────────────────────┘
          │
          ▼ (WebSocket)
┌────────────────────────────────┐
│  Subscribed Clients            │  React components
│   - Only see rows they can     │  (via useEffect + supabase
│     SELECT via RLS              │   .channel().on())
└────────────────────────────────┘
```

### Real-time Notifications

```javascript
// Component subscribes on mount
useEffect(() => {
  const channel = supabase
    .channel('notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${user.id}`,  // RLS ensures only own notifications
    }, (payload) => {
      setNotifications(prev => [payload.new, ...prev])
      toast.info(payload.new.title)
    })
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}, [user.id])
```

**RLS enforcement:** Server filters changes before sending. Client never sees other users' notifications, even if subscribed.

---

## Timezone Handling

### Problem
- Supabase Postgres runs in **UTC**
- Users are in **IST (UTC+5:30)**
- Appointments are scheduled in IST (e.g., "10:00 AM IST")
- Need to prevent booking "9:00 AM IST" at "9:30 PM IST" same day

### Solution: Explicit Timezone Conversion

```sql
-- Migration 034
CREATE FUNCTION book_appointment(...) AS $$
DECLARE
  v_now_ist TIMESTAMP := (now() AT TIME ZONE 'Asia/Kolkata');
BEGIN
  -- Date comparison
  IF p_date < v_now_ist::date THEN
    RAISE EXCEPTION 'Cannot book past dates';
  END IF;
  
  -- Time comparison (for today only)
  IF p_date = v_now_ist::date 
     AND p_start_time <= v_now_ist::time THEN
    RAISE EXCEPTION 'This time slot has already passed';
  END IF;
  
  -- ... rest of booking logic
END;
$$ LANGUAGE plpgsql;
```

**Key points:**
- `now() AT TIME ZONE 'Asia/Kolkata'` converts server UTC to IST
- Date is `DATE` type (no timezone confusion)
- Time is `TIME` type (clock time, not timestamp)
- Comparison is apples-to-apples: IST time vs IST time

**Client-side (parallel check for UX):**
```javascript
// getAvailableSlots() in src/services/doctors.js
const now = new Date()  // Local time (user's browser timezone)
const todayStr = now.toISOString().split('T')[0]
const isToday = date === todayStr
const nowMins = now.getHours() * 60 + now.getMinutes()

slots.forEach(slot => {
  const [sh, sm] = slot.start.split(':')
  const slotMins = sh * 60 + sm
  
  // Hide slots that have already started
  if (isToday && slotMins <= nowMins) {
    return  // Don't include in returned slots
  }
})
```

**Why both?**
- Client: instant UX (no flicker of past slots appearing then disappearing)
- Server: single source of truth (client check can be bypassed, but server can't)

---

## Design Decisions

### Why Supabase over traditional backend?

**Pros:**
- Zero DevOps (no servers to manage)
- Auto-generated REST API (PostgREST)
- Built-in auth, storage, realtime
- RLS = security by default
- Postgres = full SQL, transactions, triggers
- Edge functions for custom logic
- Generous free tier

**Cons:**
- Vendor lock-in (mitigated: all data in Postgres, can self-host)
- Less control over infra (can't tune Postgres config)
- Edge function cold starts (1-2s, acceptable for our use case)

**Verdict:** For a 4-role CRUD app with realtime + auth + storage, Supabase is 10x faster to build than Express + Postgres + Socket.io + S3.

### Why RPCs over GraphQL?

**RPCs:**
- Simpler (just function calls)
- Type-safe via TypeScript codegen
- Transactional by default
- Direct mapping to Postgres functions

**GraphQL:**
- Over-fetching/under-fetching solved (our queries are simple, not a problem)
- N+1 query problem (PostgREST has foreign key embedding, also solved)
- Schema stitching (we don't have microservices)

**Verdict:** RPCs are simpler and sufficient for our domain.

### Why React Context over Redux/Zustand?

**Context is enough for:**
- Auth state (1 global user object)
- Notifications (list + count)
- Theme/device detection

**Don't need Redux because:**
- No complex cross-cutting state
- No time-travel debugging needed
- Server is source of truth (optimistic UI via React Query would be next step)

**Verdict:** Context keeps bundle small and code simple. Can migrate to Zustand later if needed.

---

## Performance Considerations

### Database Indexes

Every `WHERE`, `JOIN`, and `ORDER BY` in hot paths has an index:

```sql
-- Appointment queries
CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor_date ON appointments(doctor_id, appointment_date);
CREATE INDEX idx_appointments_status ON appointments(status);

-- Smart Swap discovery
CREATE INDEX idx_swap_doctor_open ON slot_swap_offers(doctor_id, offer_date, status);

-- Chat message retrieval
CREATE INDEX idx_messages_conversation ON chat_messages(conversation_id, created_at DESC);
```

**Verify with:** `EXPLAIN ANALYZE SELECT ...` (should show "Index Scan", not "Seq Scan")

### Bundle Optimization

```javascript
// Vite config
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        'charts': ['chart.js', 'react-chartjs-2'],
        'supabase': ['@supabase/supabase-js'],
      },
    },
  },
},
```

**Result:** Parallel chunk loading, better caching (vendor chunks change rarely)

### Lazy Loading

```javascript
// App.jsx
const PatientDashboard = lazy(() => import('./pages/patient/PatientDashboard'))
const DoctorQueue = lazy(() => import('./pages/doctor/DoctorQueue'))
// ... etc

// Routes wrapped in Suspense
<Suspense fallback={<Loading />}>
  <Route path="/patient/dashboard" element={<PatientDashboard />} />
</Suspense>
```

**Result:** Initial bundle <200 KB, routes load on demand

---

## Future Architecture Considerations

### Potential Improvements

1. **Caching Layer**
   - Redis for hot data (doctor availability, active queue)
   - Reduces DB load on high traffic

2. **Read Replicas**
   - Supabase Pro supports read replicas
   - Route analytics/reports queries to replica

3. **Queue System**
   - Replace pg_cron with dedicated queue (BullMQ, Inngest)
   - Better retry logic, observability

4. **Event Sourcing**
   - Audit log as event stream
   - Replay events to rebuild state
   - Currently: point-in-time snapshots only

5. **GraphQL Layer**
   - If mobile app has very different query patterns
   - PostgREST + Hasura on top of same DB

---

## Related Documentation

- [Features Guide](./FEATURES.md) - User-facing feature documentation
- [Security Guide](./SECURITY.md) - Security architecture deep-dive
- [Deployment Guide](./DEPLOYMENT.md) - Production deployment
- [API Reference](./API.md) - RPC and endpoint documentation
