# Database Migrations

All database schema for MediBook lives here, in **numbered, dependency-ordered**
files. This folder is the single source of truth — there are no loose `.sql`
files elsewhere in the repo anymore.

## How to apply

These migrations are written to be run **once each, in order**. Run them on a
fresh Supabase project from `001` upward.

### Option A — Supabase SQL Editor (manual)
Open the Supabase Dashboard → SQL Editor, then paste and run each file in
numeric order (001 → 020). Wait for each to succeed before the next.

### Option B — Supabase CLI
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```
The CLI tracks applied migrations in `supabase_migrations.schema_migrations`,
so each file runs exactly once.

## Order and what each file does

| # | File | Purpose | Depends on |
|---|------|---------|-----------|
| 001 | base_schema | Core tables (profiles, doctors, patients, departments, doctor_availability, appointments, notification_logs), `handle_new_user` + `handle_updated_at`, slot unique index, base RLS | — |
| 002 | profile_management | `avatars` storage bucket + policies, profile admin policies, extra profile fields | 001 |
| 003 | fix_profiles | Recreates `handle_new_user` trigger + backfills profiles for existing auth users | 001 |
| 004 | security_fix | Prevents users changing their own `role` (RLS) | 001 |
| 005 | onboarding | `onboarding_progress`, `user_preferences`, `user_consents`, `is_onboarding_complete()` | 001 |
| 006 | hospital_info | `hospital-photos` + `hospital-docs` storage buckets and policies | 001 |
| 007 | hospital_management | Hospital tables, doctor↔hospital links, related RLS | 001, 006 |
| 008 | collaborate | `collaboration_applications` + `collaborate-docs` bucket | 001 |
| 009 | collaborate_photo | `collaborate-photos` bucket + policies | 008 |
| 010 | fix_collaboration_rls | Corrects insert/select RLS on `collaboration_applications` | 008 |
| 011 | fix_collaborate_docs_access | Admin-only read policy for `collaborate-docs` | 008, 009 |
| 012 | complaints | Complaints tables + RLS | 001 |
| 013 | notifications | `notifications`, `push_subscriptions`, `notification_preferences`, appointment-notification trigger | 001 |
| 014 | chat_sessions_ai | AI assistant `chat_sessions` + `chat_messages` (NOTE: this `chat_messages` is the AI chat, distinct from `direct_messages` in 020) | 001 |
| 015 | audit_logs | `audit_logs` table + admin-read RLS | 001 |
| 016 | account_closure | `close_my_account()` RPC + closure tracking | 001, 007 |
| 017 | appointment_concurrency | Atomic `book_appointment()` RPC, `book_appointment_with_capacity()`, re-asserts active-slot unique index | 001 |
| 018 | freed_slots | Early-completion freed slots + waitlist, `complete_appointment_early()`, `book_freed_slot()` | 001, 013 |
| 019 | medical_history | `medical_history`, `medical_documents` (3-per-category cap), `medical_access_grants`, `consultation_notes`, `medical-records` bucket | 001, 013 |
| 020 | chat_direct_messages | Patient↔doctor chat: `conversations`, `direct_messages` (realtime), `get_or_create_conversation()`, `accept_new_patient_messages` toggle | 001, 013 |
| 021 | medical_record_audit | Server-side PHI access log + audited `get_patient_records_for_doctor()` and `log_medical_document_access()` RPCs | 019 |
| 022 | payments | Appointment payments (Razorpay online + offline/cash): `payments` table, `request_appointment_payment()`, `pay_appointment_offline()`, `mark_payment_paid_online()` (service-role) | 001, 018 |

## Idempotency notes

- **001, 002, 017, 018, 019, 020** are largely re-runnable (use `IF NOT EXISTS`,
  `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).
- **005 (onboarding), 013 (notifications), 015 (audit_logs)** create policies
  **without** `DROP POLICY IF EXISTS`. Re-running them will fail with
  "policy already exists". They are designed to run **once**. If you must
  re-run, drop the affected policies first.
- **003 (fix_profiles)** ends with a `SELECT` that returns rows — harmless in the
  SQL editor.

## Conventions for new migrations

1. Add the next number: `021_short_name.sql`.
2. Make it idempotent where practical: `CREATE TABLE IF NOT EXISTS`,
   `CREATE OR REPLACE FUNCTION`, and always `DROP POLICY IF EXISTS` before
   `CREATE POLICY`.
3. Document it in the table above with its dependencies.
4. Never edit an already-applied migration in place — add a new one.





