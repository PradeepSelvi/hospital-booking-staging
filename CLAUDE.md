# CLAUDE.md

Guidance for AI coding assistants (Claude Code, Kiro, Cursor, etc.) working in
this repository.

## Project overview

**MediBook** is a hospital appointment & management system. Frontend is React 18
+ Vite; backend is Supabase (Postgres with Row Level Security, Auth, Storage,
Realtime, Edge Functions). Four roles: **PATIENT, DOCTOR, ADMIN, HOSPITAL**.

See `README.md` for setup, scripts, and environment variables.

## Architecture & conventions

- **Data access** goes through `src/services/*.js` — one module per domain
  (`appointments`, `chat`, `medicalHistory`, `doctors`, `profiles`, ...).
  UI components/pages should call services, not the Supabase client directly.
- **Supabase client** is created once in `src/lib/supabase.js`. The browser uses
  the **anon key only**. The service-role key lives exclusively in Edge Functions.
- **Security model is RLS-first.** Authorization is enforced in the database via
  policies, not in the client. When adding tables, always add RLS policies.
  For multi-step or race-sensitive operations (e.g. booking), use a Postgres
  function (RPC) so the check + write are atomic — see `book_appointment` and
  `get_or_create_conversation`.
- **Routing**: `src/App.jsx` defines lazy-loaded routes. `ProtectedRoute`
  (`src/routes/ProtectedRoute.jsx`) gates by role and waits for the profile to
  load before rendering.
- **Patient** screens use the top `Navbar`; **Doctor/Admin/Hospital** screens use
  the `Sidebar` inside their layout. The Sidebar has a mobile drawer.
- **Styling**: Bootstrap 5 + custom classes in `src/index.css`
  (`card-custom`, `btn-primary-custom`, `form-input-custom`, etc.). Reuse these.
- **Input** is sanitized via `src/security/sanitize.js` before persisting.

## Database migrations — IMPORTANT

- The single source of truth is **`supabase/migrations/`** (numbered `001`→`020`).
- Read `supabase/migrations/README.md` before changing schema.
- To add schema: create the next-numbered file (`021_...`), make it idempotent
  (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
  `DROP POLICY IF EXISTS` before `CREATE POLICY`), and document it in that README.
- **Never edit an already-applied migration** — add a new one.
- Note the name clash history: the AI assistant uses `chat_messages`
  (migration 014); patient↔doctor chat uses `direct_messages` (migration 020).
  Don't reintroduce a `chat_messages` collision.

## Verifying changes

- After editing code, run `npm run lint` and `npm run build` to confirm it compiles.
- There is no automated test suite yet (a known gap). When adding tests, prefer
  Vitest + React Testing Library.

## Git workflow

- Never push directly to `main`. Create a feature branch, commit, push, open a PR.
- Only create commits when explicitly asked.
