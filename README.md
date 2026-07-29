# MediBook — Hospital Appointment & Management System

A full-stack hospital platform for booking and managing appointments, built with
React + Vite on the front end and Supabase (Postgres, Auth, Storage, Realtime,
Edge Functions) on the back end. It supports four roles — **Patient, Doctor,
Admin, Hospital** — plus email/in-app notifications and an AI assistant.

## Features

### Core Features
- **Authentication & onboarding** with role-based access (Patient / Doctor / Admin / Hospital)
- **Doctor search** by name, specialization, and department
- **Appointment booking** with atomic, race-safe slot reservation and timezone-aware validation
- **Early-completion freed slots** — released time is offered to waitlisted patients
- **Medical history vault** — patients upload documents (3 per category) with granular, per-appointment consent
- **Consultation notes** — doctors record advisories/prescriptions at closing
- **Patient ↔ doctor chat** — realtime 1:1 messaging with a per-doctor "accept new patients" toggle
- **Complaints**, **hospital management**, and a **collaboration/onboarding** flow
- **Notifications** — in-app (realtime) and email
- **AI assistant** for patient queries and guided booking
- **Payment integration** — Razorpay with online/offline options and automatic settlement

### Advanced Features
- **🔄 Smart Swap Slot Exchange** — Decentralized, anonymous peer-to-peer marketplace where patients trade appointment slots. Givers who move to later slots earn co-pay discounts (10%), optimizing schedule utilization while reducing no-shows.
- **⏱️ Live Queue & ETA Tracking** — Real-time waiting room position tracking with SMS notifications. Patients see their queue position and estimated wait time, updated every 30 seconds.
- **🔐 Multi-Factor Authentication (MFA/TOTP)** — Time-based one-time passwords with recovery codes. Supports Google Authenticator, Authy, etc. Admin MFA reset capability with audit logging.
- **⭐ Hospital Reviews & Ratings** — Verified patient reviews with moderation. Aggregated ratings and integration with external review platforms (Google Places).

### Security Features
- **Row Level Security (RLS)** on all tables with multi-layer policies
- **Input sanitization** and XSS prevention across all user inputs
- **Pwned password check** integration with Have I Been Pwned API
- **Rate limiting** on auth endpoints (login, register, password reset)
- **CAPTCHA** on sensitive flows (registration, login after failures)
- **Audit logging** for medical records, payments, MFA resets, and account closures
- **AAL2 gating** for sensitive operations (requires MFA verification)

## Tech stack

- **Frontend:** React 18, Vite 5, React Router 6, Bootstrap 5, Chart.js, react-toastify
- **Backend:** Supabase (Postgres + Row Level Security, Auth, Storage, Realtime)
- **Edge Functions (Deno):** `chat-assistant`, `collab-document`, `send-reminders`

## Prerequisites

- Node.js 18+ and npm
- A Supabase project (URL + anon key)
- (Optional) Supabase CLI, for `db push` and deploying edge functions

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#   then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Apply the database schema (see supabase/migrations/README.md)
#    Run migrations 001 → 020 in order on your Supabase project.

# 4. Start the dev server
npm run dev
```

The app runs at http://localhost:5173.

## Documentation

Comprehensive documentation is available in the `/docs` folder:

- **[Features Guide](./docs/FEATURES.md)** — Detailed documentation of all features including Smart Swap, Live Queue, MFA, and more
- **[Deployment Guide](./docs/DEPLOYMENT.md)** — Complete step-by-step production deployment instructions
- **[Architecture Guide](./docs/ARCHITECTURE.md)** — System design, concurrency model, and technical decisions *(coming soon)*
- **[Security Guide](./docs/SECURITY.md)** — Comprehensive security documentation *(coming soon)*
- **[API Reference](./docs/API.md)** — RPC and endpoint documentation *(coming soon)*

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |

## Environment variables

### Frontend (`.env`, committed template in `.env.example`)
| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key (safe for the browser) |
| `VITE_RAZORPAY_KEY_ID` | Razorpay publishable key id (safe for the browser) |

> The browser only ever uses the anon key. The service-role key must **never**
> appear in frontend code — it is used only in Edge Functions.

### Edge Function secrets (set via `supabase secrets set`)
| Variable | Used by |
|----------|---------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | all functions |
| `SUPABASE_ANON_KEY` | `chat-assistant` |
| `NVIDIA_API_KEY` | `chat-assistant` (LLM provider) |
| `ALLOWED_ORIGINS` | `chat-assistant` (CORS allow-list) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `razorpay-create-order`, `razorpay-verify-payment` |
| `RAZORPAY_WEBHOOK_SECRET` | `razorpay-webhook` (server-to-server settlement) |

## Database

All schema lives in **`supabase/migrations/`** as 34 numbered, dependency-ordered
files (`001` → `034`). The migrations cover:

- **001-020:** Core schema (profiles, appointments, chat, medical history, payments)
- **021:** Medical record audit logging
- **022:** Razorpay payment integration
- **023-024:** Auth hardening and PII encryption
- **025-026:** Admin payment management and reporting
- **027-028:** MFA/TOTP with recovery codes and AAL2 gating
- **029-030:** Hospital and place reviews/ratings
- **031:** Pentest hardening (rate limiting, CAPTCHA, additional RLS)
- **032:** Live queue position and ETA tracking
- **033:** Smart Swap peer-to-peer slot exchange
- **034:** Timezone-aware past time slot rejection

Apply migrations in order on a fresh project. See `/docs/DEPLOYMENT.md` for detailed migration guide.

## Project structure

```
src/
  components/     Reusable UI (Navbar, Sidebar, ChatThread, modals, ...)
  context/        AuthContext, NotificationContext, DeviceContext
  pages/          Route screens grouped by role (patient/, doctor/, admin/, hospital/)
  services/       Supabase data access (appointments, chat, medicalHistory, ...)
  routes/         ProtectedRoute (role gating)
  security/       Client-side sanitization & validators
  hooks/          useDebounce, useDeviceDetect
  lib/            supabase.js (client setup)
supabase/
  migrations/     Canonical, ordered SQL schema (single source of truth)
  functions/      Deno edge functions
```

## Payments (Razorpay)

Appointments can be billed at consultation close. The doctor sets an amount in
the consultation panel ("Save & Request Payment"); the appointment stays open
until the patient pays. The patient then chooses:

- **Online** — Razorpay Standard Checkout. The `razorpay-create-order` edge
  function creates the order (amount read from the DB, never the client), the
  modal collects payment, and `razorpay-verify-payment` validates the
  HMAC-SHA256 signature server-side before marking the payment paid and
  completing the appointment.
- **Offline** — cash at the clinic; `pay_appointment_offline()` records it and
  completes the appointment.

Either way a receipt is generated, and a "Payment issue?" link routes to the
complaints section (category: Payment).

Settlement has two layers, so payments are never lost:
1. **Browser verify** (`razorpay-verify-payment`) — fast path right after checkout.
2. **Webhook** (`razorpay-webhook`) — Razorpay calls this server-to-server when
   the payment is captured, so the appointment completes even if the patient
   closes the tab before the browser verify runs. It validates the webhook
   signature and is idempotent.

**Setup (test):**
1. Apply migration `022_payments.sql`.
2. Set the frontend key id in `.env`: `VITE_RAZORPAY_KEY_ID=rzp_test_...`
3. Set the secrets on Supabase (never in frontend/.env):
   ```bash
   supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=your_secret
   ```
4. Deploy the functions:
   ```bash
   supabase functions deploy razorpay-create-order
   supabase functions deploy razorpay-verify-payment
   supabase functions deploy razorpay-webhook --no-verify-jwt
   ```
5. In the Razorpay Dashboard → **Settings → Webhooks**, add a webhook:
   - URL: `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`
   - Active events: `payment.captured`, `order.paid`
   - Secret: a value you choose; set the same value as `RAZORPAY_WEBHOOK_SECRET`:
     ```bash
     supabase secrets set RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
     ```

**Going live (real payments):**
- Complete Razorpay KYC and activate **Live mode** in the dashboard.
- Generate **Live** API keys (`rzp_live_...`) and a **Live** webhook secret.
- Swap the values — no code changes needed (the integration is mode-agnostic):
  ```bash
  supabase secrets set RAZORPAY_KEY_ID=rzp_live_xxx RAZORPAY_KEY_SECRET=live_secret RAZORPAY_WEBHOOK_SECRET=live_webhook_secret
  supabase functions deploy razorpay-create-order
  supabase functions deploy razorpay-verify-payment
  supabase functions deploy razorpay-webhook --no-verify-jwt
  ```
  Set `VITE_RAZORPAY_KEY_ID=rzp_live_xxx` in `.env` and rebuild the frontend.
- Re-create the webhook in the dashboard's **Live** mode pointing at the same URL.

The `KEY_SECRET` and `WEBHOOK_SECRET` live only in Supabase secrets and are used
solely inside the edge functions — they never reach the browser. Amounts are
read from the database server-side, so they can't be tampered with from the
client, and payments are only marked paid after a verified signature.

## Deployment

- **Frontend:** `npm run build` produces a static `dist/` — deploy to any static
  host (Netlify, Vercel, etc.).
- **Database:** apply `supabase/migrations/` to the target project.
- **Edge functions:** `supabase functions deploy <name>` and set secrets.

## Git workflow

- Don't push directly to `main`; use a feature branch and open a PR.
- The remote requires write access to the repo — a `403` on push means the
  authenticated GitHub account isn't a collaborator (see the project owner).
