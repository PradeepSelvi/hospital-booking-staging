# MediBook Security Documentation

Comprehensive security architecture, practices, and guidelines for the hospital booking system.

## Table of Contents

- [Security Overview](#security-overview)
- [Authentication & Authorization](#authentication--authorization)
- [Row Level Security (RLS)](#row-level-security-rls)
- [Input Validation & Sanitization](#input-validation--sanitization)
- [Rate Limiting](#rate-limiting)
- [Multi-Factor Authentication](#multi-factor-authentication)
- [Data Protection](#data-protection)
- [Audit Logging](#audit-logging)
- [Penetration Test Findings](#penetration-test-findings)
- [Security Best Practices](#security-best-practices)
- [Incident Response](#incident-response)

---

## Security Overview

### Defense in Depth Strategy

MediBook employs a **multi-layered security approach** with controls at every level:

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Client-Side Validation                │  Fast feedback, not security
│   - Input sanitization                          │
│   - CAPTCHA (hCaptcha)                          │
│   - Pwned password check                        │
└───────────────────┬─────────────────────────────┘
                    │
┌─────────────────────────────────────────────────┐
│  Layer 2: Edge Function Validation              │  Server-side guard
│   - Re-validate inputs                          │
│   - Rate limit enforcement                      │
│   - CAPTCHA server verification                 │
└───────────────────┬─────────────────────────────┘
                    │
┌─────────────────────────────────────────────────┐
│  Layer 3: Row Level Security (RLS)              │  Database access control
│   - auth.uid() enforcement                      │
│   - Policy-based access (patient/doctor/admin)  │
│   - AAL2 gating for sensitive ops               │
└───────────────────┬─────────────────────────────┘
                    │
┌─────────────────────────────────────────────────┐
│  Layer 4: Database Constraints                  │  Data integrity
│   - NOT NULL, CHECK constraints                 │
│   - Foreign keys with CASCADE                   │
│   - Unique indexes                              │
└─────────────────────────────────────────────────┘
```

### Security Principles

1. **Zero Trust:** Never trust client input; validate server-side
2. **Least Privilege:** Users/roles have minimum required permissions
3. **Fail Secure:** Errors deny access by default
4. **Defense in Depth:** Multiple security layers
5. **Audit Everything:** Log all sensitive operations

---

## Authentication & Authorization

### Authentication Flow

```
User Login
    │
    ▼
┌────────────────────────────────┐
│ 1. Supabase Auth               │
│    - Email/password or OAuth   │
│    - bcrypt password hashing   │
│    - JWT token issued (AAL1)   │
└────────────┬───────────────────┘
             │
             ├── Has MFA? ──────────┐
             │  YES                │  NO
             │                     │
             ▼                     ▼
    ┌───────────────────┐   ┌──────────────┐
    │ 2. MFA Challenge  │   │ Logged in    │
    │    - TOTP code    │   │  (AAL1 only) │
    │    - Recovery code│   └──────────────┘
    └─────────┬─────────┘
              │
              ▼
    ┌────────────────────┐
    │ 3. Upgraded to AAL2│
    │    (MFA verified)  │
    └────────────────────┘
```

### JWT Token Structure

```json
{
  "sub": "uuid-of-user",
  "email": "patient@example.com",
  "role": "authenticated",
  "aal": "aal2",
  "amr": [{"method": "password", "timestamp": 1704067200}, {"method": "totp", "timestamp": 1704067210}],
  "exp": 1704070800,
  "iat": 1704067200
}
```

**Key Claims:**
- `sub`: User ID (maps to `profiles.id`)
- `aal`: Authentication Assurance Level (`aal1` or `aal2`)
- `amr`: Authentication Methods References
- `exp`: Token expiration (1 hour by default)

### Role-Based Access Control (RBAC)

**Four Roles:**

1. **PATIENT** - Can book appointments, view own medical records, chat with doctors
2. **DOCTOR** - Can view assigned appointments, manage availability, access consented medical records
3. **HOSPITAL** - Can manage hospital profile, add doctors, view analytics
4. **ADMIN** - Full access, user management, system administration

**Role stored in:** `profiles.role` (ENUM)

**Enforced via:**
- RLS policies: `profiles.role = 'DOCTOR'`
- Frontend route guards: `<ProtectedRoute allowedRoles={['DOCTOR']} />`
- RPC validation: `IF (SELECT role FROM profiles WHERE id = auth.uid()) <> 'ADMIN' THEN RAISE EXCEPTION`

---

## Row Level Security (RLS)

### What is RLS?

**Postgres-native access control** enforced at the database level. Every `SELECT`, `INSERT`, `UPDATE`, `DELETE` is filtered by policies.

**Benefits:**
- Cannot be bypassed (not in app code)
- Applies to PostgREST API, RPCs, and direct SQL
- Single source of truth for authorization


### RLS Policy Examples

#### Appointments Table

```sql
-- Patients can see their own appointments
CREATE POLICY "patients_select_own"
  ON appointments FOR SELECT
  USING (patient_id = auth.uid());

-- Doctors can see appointments they're assigned to
CREATE POLICY "doctors_select_assigned"
  ON appointments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM doctors 
    WHERE id = appointments.doctor_id 
      AND user_id = auth.uid()
  ));

-- Admins can see all
CREATE POLICY "admins_select_all"
  ON appointments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
      AND role = 'ADMIN'
  ));

-- Patients can only insert appointments for themselves
CREATE POLICY "patients_insert_own"
  ON appointments FOR INSERT
  WITH CHECK (patient_id = auth.uid());
```

#### Medical History (Multi-Layer RLS)

```sql
-- Patient owns their records
CREATE POLICY "owner_full_access"
  ON medical_history FOR ALL
  USING (patient_id = auth.uid());

-- Doctors need explicit consent (medical_history_access)
CREATE POLICY "doctors_with_consent"
  ON medical_history FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM medical_history_access mha
    JOIN doctors d ON d.id = mha.doctor_id
    WHERE mha.patient_id = medical_history.patient_id
      AND d.user_id = auth.uid()
      AND mha.granted = TRUE
  ));
```

#### Slot Swap Offers (Anonymity via RLS)

```sql
-- Owner sees their own offers
CREATE POLICY "swap_select_own"
  ON slot_swap_offers FOR SELECT
  USING (offered_by = auth.uid());

-- Everyone else uses anonymized RPC (no direct SELECT)
-- RLS blocks direct table access, forcing use of list_swap_offers()
```

### AAL2-Gated Operations

Sensitive operations require **AAL2** (MFA verified):

```sql
-- View medical records (requires AAL2)
CREATE POLICY "medical_records_aal2"
  ON medical_history FOR SELECT
  USING (
    patient_id = auth.uid()
    AND auth.current_session_aal() = 'aal2'
  );

-- Account closure (requires AAL2)
CREATE POLICY "account_closure_aal2"
  ON account_closures FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND auth.current_session_aal() = 'aal2'
  );
```

**If user has MFA but session is AAL1:**
- Frontend redirects to `/mfa-challenge`
- User re-verifies TOTP
- Session upgraded to AAL2
- Operation allowed


---

## Input Validation & Sanitization

### Client-Side Sanitization

**Location:** `src/security/sanitize.js`

```javascript
// Strip HTML tags, prevent XSS
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input
  return input
    .replace(/<[^>]*>/g, '')        // Remove HTML tags
    .replace(/[<>]/g, '')            // Remove angle brackets
    .trim()
}

// Deep sanitize object (e.g., form data)
export function sanitizeFormData(obj) {
  const sanitized = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value)
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeFormData(value)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}
```

**Used in:**
- All form submissions
- Chat messages
- Appointment reasons
- Review text
- User profiles

### Server-Side Validation

**Location:** Postgres functions (RPCs)

```sql
CREATE FUNCTION book_appointment(..., p_reason TEXT) AS $$
BEGIN
  -- Null/empty check
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    p_reason := NULL;
  END IF;
  
  -- Length validation
  IF length(p_reason) > 500 THEN
    RAISE EXCEPTION 'Reason too long (max 500 chars)';
  END IF;
  
  -- Insert with sanitized value
  INSERT INTO appointments (..., reason) 
  VALUES (..., NULLIF(btrim(p_reason), ''));
END;
$$ LANGUAGE plpgsql;
```

### Validators

**Location:** `src/security/validators.js`

```javascript
// Email format
export function validateEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

// Phone (Indian format)
export function validatePhone(phone) {
  const regex = /^[6-9]\d{9}$/
  return regex.test(phone.replace(/\D/g, ''))
}

// Password strength (min 8 chars, 1 upper, 1 lower, 1 number)
export function validatePasswordStrength(password) {
  return password.length >= 8 
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
}

// Date not in past
export function validateFutureDate(date) {
  return new Date(date) >= new Date().setHours(0, 0, 0, 0)
}
```

### Pwned Password Check

**Integration with Have I Been Pwned API using k-anonymity:**

```javascript
// src/security/pwnedPassword.js
import crypto from 'crypto'

export async function checkPwnedPassword(password) {
  // Hash password
  const sha1 = crypto.createHash('sha1')
    .update(password)
    .digest('hex')
    .toUpperCase()
  
  // k-anonymity: only send first 5 chars
  const prefix = sha1.substring(0, 5)
  const suffix = sha1.substring(5)
  
  // Query HIBP API
  const response = await fetch(
    `https://api.pwnedpasswords.com/range/${prefix}`
  )
  const hashes = await response.text()
  
  // Check if full hash appears in results
  return hashes.split('\n').some(line => {
    const [hash] = line.split(':')
    return hash === suffix
  })
}
```

**Result:** Password never leaves client in plaintext; only hash prefix is sent.


---

## Rate Limiting

**Migration:** `023_auth_hardening.sql`

### Implementation

Rate limits stored in `rate_limit` table with user ID + action:

```sql
CREATE TABLE rate_limit (
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  count INT NOT NULL DEFAULT 1,
  window_start TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, action)
);
```

### Rate Limit Function

```sql
CREATE FUNCTION check_rate_limit(
  p_action TEXT,
  p_max_attempts INT,
  p_window_minutes INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_count INT;
  v_window_start TIMESTAMP;
BEGIN
  SELECT count, window_start INTO v_count, v_window_start
  FROM rate_limit
  WHERE user_id = auth.uid() AND action = p_action;
  
  -- Reset if window expired
  IF v_window_start < NOW() - (p_window_minutes || ' minutes')::INTERVAL THEN
    DELETE FROM rate_limit 
    WHERE user_id = auth.uid() AND action = p_action;
    RETURN TRUE;
  END IF;
  
  -- Check limit
  IF v_count >= p_max_attempts THEN
    RETURN FALSE;  -- Rate limit exceeded
  END IF;
  
  -- Increment counter
  INSERT INTO rate_limit (user_id, action, count, window_start)
  VALUES (auth.uid(), p_action, 1, NOW())
  ON CONFLICT (user_id, action) 
  DO UPDATE SET count = rate_limit.count + 1;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Configured Limits

| Action | Limit | Window | Migration |
|--------|-------|--------|-----------|
| Login attempts | 5 | 15 min | 023 |
| Password reset | 3 | 1 hour | 023 |
| MFA verification | 10 | 5 min | 028 |
| Registration | 5 | 10 min | 023 |
| Forgot password | 10 | 1 hour | 023 |

### Usage in RPCs

```sql
CREATE FUNCTION authenticate_user(...) AS $$
BEGIN
  -- Check rate limit
  IF NOT check_rate_limit('login', 5, 15) THEN
    RAISE EXCEPTION 'Too many login attempts. Try again in 15 minutes.'
      USING ERRCODE = '42P01';
  END IF;
  
  -- Proceed with authentication
  ...
END;
$$;
```

### CAPTCHA Integration

After 3 failed login attempts, CAPTCHA is required:

```javascript
// Client-side (Login.jsx)
const [failedAttempts, setFailedAttempts] = useState(0)
const [showCaptcha, setShowCaptcha] = useState(false)

async function handleLogin() {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setFailedAttempts(prev => prev + 1)
      if (failedAttempts >= 2) setShowCaptcha(true)
    }
  } catch (err) {
    // Handle
  }
}

{showCaptcha && (
  <Captcha 
    sitekey={HCAPTCHA_SITEKEY}
    onVerify={handleCaptchaVerify}
  />
)}
```

**Server verification** in edge functions validates CAPTCHA token with hCaptcha API.


---

## Multi-Factor Authentication

**Migrations:** `027_mfa_recovery_codes.sql`, `028_mfa_aal2_gating.sql`

### TOTP Enrollment

```sql
CREATE FUNCTION enroll_totp() RETURNS JSON AS $$
DECLARE
  v_secret TEXT;
  v_qr_uri TEXT;
BEGIN
  -- Generate TOTP secret (base32, 160 bits)
  v_secret := encode(gen_random_bytes(20), 'base32');
  
  -- Build QR code URI
  v_qr_uri := 'otpauth://totp/MediBook:' || auth.email() 
    || '?secret=' || v_secret 
    || '&issuer=MediBook';
  
  -- Supabase handles factor creation
  -- Return secret + QR for client display
  RETURN json_build_object(
    'secret', v_secret,
    'qr_uri', v_qr_uri
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Recovery Codes

```sql
CREATE TABLE mfa_recovery_codes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,  -- bcrypt hashed
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recovery_user ON mfa_recovery_codes(user_id);

-- Generate 10 codes
CREATE FUNCTION generate_recovery_codes() 
RETURNS TEXT[] AS $$
DECLARE
  v_codes TEXT[] := ARRAY[]::TEXT[];
  v_code TEXT;
  v_hash TEXT;
BEGIN
  -- Delete old codes
  DELETE FROM mfa_recovery_codes WHERE user_id = auth.uid();
  
  -- Generate 10 new codes
  FOR i IN 1..10 LOOP
    v_code := encode(gen_random_bytes(8), 'base64');
    v_hash := crypt(v_code, gen_salt('bf'));  -- bcrypt
    
    INSERT INTO mfa_recovery_codes (user_id, code_hash)
    VALUES (auth.uid(), v_hash);
    
    v_codes := array_append(v_codes, v_code);
  END LOOP;
  
  RETURN v_codes;  -- Plain codes returned ONCE for user to save
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### MFA Challenge Flow

1. User enters email/password → AAL1 session
2. If MFA enrolled, redirect to `/mfa-challenge`
3. User enters TOTP code (6 digits) or recovery code
4. Frontend calls `supabase.auth.mfa.challenge()` and `.verify()`
5. Supabase verifies code, upgrades session to AAL2
6. User can now access AAL2-gated features

### Admin MFA Reset

**Edge Function:** `admin-mfa-reset`

```typescript
// supabase/functions/admin-mfa-reset/index.ts
export default async function handler(req: Request) {
  // Verify admin role
  const { user } = await supabaseClient.auth.getUser(
    req.headers.get('Authorization')?.split(' ')[1]
  )
  
  const profile = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  if (profile.data?.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 })
  }
  
  // Unenroll all MFA factors for target user
  const { targetUserId, reason } = await req.json()
  
  await supabaseAdmin.auth.admin.mfa.unenrollFactors(targetUserId)
  
  // Delete recovery codes
  await supabaseAdmin
    .from('mfa_recovery_codes')
    .delete()
    .eq('user_id', targetUserId)
  
  // Audit log
  await supabaseAdmin.from('mfa_reset_audit').insert({
    admin_id: user.id,
    target_user_id: targetUserId,
    reason,
  })
  
  // Notify user via email
  await sendEmail(targetUserId, 'MFA has been reset by an admin')
  
  return new Response('MFA reset successful')
}
```


---

## Data Protection

### PII Encryption at Rest

**Migration:** `024_profiles_pii_rls.sql`

Sensitive fields encrypted using Postgres `pgcrypto`:

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt phone number
UPDATE profiles
SET phone_encrypted = pgp_sym_encrypt(
  phone, 
  current_setting('app.encryption_key')
);

-- Decrypt on read
SELECT 
  id, 
  name, 
  pgp_sym_decrypt(phone_encrypted, current_setting('app.encryption_key')) AS phone
FROM profiles
WHERE id = auth.uid();
```

**Encrypted Fields:**
- Phone numbers
- Emergency contact info
- Addresses
- Medical record file metadata

**Encryption Key Management:**
- Key stored in Supabase secrets (never in code/DB)
- Set via: `supabase secrets set ENCRYPTION_KEY=<base64-key>`
- Rotation: Update secret, re-encrypt all data

### Medical Document Storage

**Supabase Storage bucket:** `medical-documents`

```sql
-- Bucket config (in Supabase Dashboard)
CREATE POLICY "owner_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'medical-documents'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

CREATE POLICY "owner_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'medical-documents'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

-- Doctors with consent (via custom function)
CREATE POLICY "doctor_with_consent_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'medical-documents'
    AND doctor_has_consent(
      auth.uid(), 
      (storage.foldername(name))[1]::UUID
    )
  );
```

**File Path Structure:**
```
medical-documents/
  ├── <patient_uuid>/
  │   ├── blood-tests/
  │   │   ├── <timestamp>_report.pdf
  │   ├── imaging/
  │   │   ├── <timestamp>_xray.jpg
  │   └── ...
```

**Security Features:**
- Private bucket (no public access)
- RLS enforced (owner + consented doctors only)
- File size limit: 10 MB
- Allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`

### Data Minimization

**Principles:**
- Collect only necessary data
- Retain data only as long as needed
- Allow user-initiated deletion (account closure)

**Account Closure Flow:**

```sql
-- Migration 016_account_closure.sql
CREATE FUNCTION close_account(p_reason TEXT) RETURNS VOID AS $$
BEGIN
  -- AAL2 required
  IF auth.current_session_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'MFA verification required';
  END IF;
  
  -- Audit log
  INSERT INTO account_closures (user_id, reason, closed_at)
  VALUES (auth.uid(), p_reason, NOW());
  
  -- Anonymize PII (keep for 90 days for legal/audit)
  UPDATE profiles
  SET 
    email = 'deleted_' || id || '@example.com',
    phone = NULL,
    address = NULL,
    name = 'Deleted User'
  WHERE id = auth.uid();
  
  -- Revoke all medical history access
  DELETE FROM medical_history_access WHERE patient_id = auth.uid();
  
  -- Cancel future appointments
  UPDATE appointments
  SET status = 'CANCELLED', reason = 'Account closed'
  WHERE patient_id = auth.uid()
    AND appointment_date > CURRENT_DATE;
  
  -- Supabase Auth deletion (cascades to profile after 90 days)
  -- Done via scheduled job
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```


---

## Audit Logging

### Medical Record Access Audit

**Migration:** `021_medical_record_audit.sql`

```sql
CREATE TABLE medical_record_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES profiles(id),
  accessor_id UUID NOT NULL REFERENCES profiles(id),
  appointment_id BIGINT REFERENCES appointments(id),
  document_id BIGINT REFERENCES medical_history(id),
  action TEXT NOT NULL,  -- 'VIEW', 'DOWNLOAD'
  accessed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Trigger on medical_history reads
CREATE FUNCTION audit_medical_record_access() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO medical_record_audit (
    patient_id, accessor_id, document_id, action
  ) VALUES (
    NEW.patient_id, auth.uid(), NEW.id, 'VIEW'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medical_history_access_audit
  AFTER SELECT ON medical_history
  FOR EACH ROW EXECUTE FUNCTION audit_medical_record_access();
```

**Patient View:**
```sql
-- Get my medical record access log
SELECT 
  a.accessor_id,
  p.name AS accessor_name,
  p.role AS accessor_role,
  a.action,
  a.accessed_at,
  a.appointment_id
FROM medical_record_audit a
JOIN profiles p ON p.id = a.accessor_id
WHERE a.patient_id = auth.uid()
ORDER BY a.accessed_at DESC;
```

### Payment Audit

Every payment transition is logged:

```sql
-- Migration 022_payments.sql
CREATE TABLE payment_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payments(id),
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES profiles(id),
  razorpay_payment_id TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Trigger
CREATE FUNCTION audit_payment_change() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO payment_audit (
    payment_id, old_status, new_status, changed_by
  ) VALUES (
    NEW.id, OLD.status, NEW.status, auth.uid()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### MFA Reset Audit

```sql
-- Migration 027_mfa_recovery_codes.sql
CREATE TABLE mfa_reset_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id UUID NOT NULL REFERENCES profiles(id),
  target_user_id UUID NOT NULL REFERENCES profiles(id),
  reason TEXT,
  reset_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Immutable (write-only for users, read-only for admins)
CREATE POLICY "admins_read_audit"
  ON mfa_reset_audit FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'ADMIN'
  ));
```

### Retention Policy

- **Access logs:** 2 years
- **Payment logs:** 7 years (legal requirement)
- **MFA reset logs:** Indefinite
- **Account closure logs:** 7 years

Automated cleanup via `pg_cron`:

```sql
-- Run monthly
SELECT cron.schedule(
  'audit-cleanup',
  '0 0 1 * *',  -- 1st of every month at midnight
  $$
    DELETE FROM medical_record_audit 
    WHERE accessed_at < NOW() - INTERVAL '2 years';
  $$
);
```


---

## Penetration Test Findings

**Migration:** `031_pentest_hardening.sql`

Summary of vulnerabilities found and mitigated:

### 1. Stored XSS in User Profiles

**Finding:** User-submitted profile fields (name, bio) were not sanitized, allowing `<script>` injection.

**Mitigation:**
- Client-side: `sanitizeInput()` strips HTML tags
- Server-side: `btrim()` + regex validation in RPCs
- CSP header: `script-src 'self'` (blocks inline scripts)

```sql
-- Before
INSERT INTO profiles (name) VALUES (p_name);

-- After
INSERT INTO profiles (name) 
VALUES (regexp_replace(btrim(p_name), '<[^>]*>', '', 'g'));
```

### 2. SQL Injection in Doctor Search

**Finding:** Doctor search query used string concatenation.

**Mitigation:** Replaced with parameterized query + `to_tsquery()`.

```sql
-- Before (vulnerable)
EXECUTE 'SELECT * FROM doctors WHERE name LIKE ''%' || p_query || '%''';

-- After (safe)
SELECT * FROM doctors 
WHERE to_tsvector('english', name) @@ plainto_tsquery('english', p_query);
```

### 3. Insecure Direct Object Reference (IDOR)

**Finding:** Medical record download used URL like `/documents/{id}` without ownership check.

**Mitigation:** RLS policy enforces ownership + consent check.

```sql
-- RLS prevents this at database level
SELECT * FROM medical_history WHERE id = <user-supplied-id>;
-- Only returns row if:
--   1. Requester owns it, OR
--   2. Requester is doctor with consent
```

### 4. Missing Rate Limiting

**Finding:** Login endpoint had no brute-force protection.

**Mitigation:** Implemented rate limiting (see [Rate Limiting](#rate-limiting) section).

### 5. Session Fixation

**Finding:** Session ID reused after login.

**Mitigation:** Supabase Auth regenerates token on authentication.

### 6. Clickjacking

**Finding:** No frame protection headers.

**Mitigation:** Added security headers in deployment config.

```javascript
// vercel.json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { 
          "key": "Content-Security-Policy", 
          "value": "frame-ancestors 'none'; default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" 
        }
      ]
    }
  ]
}
```

### 7. Sensitive Data in URL

**Finding:** Appointment ID in URL could leak via Referer header.

**Mitigation:** Use POST for sensitive operations, avoid embedding IDs in GET URLs.

### 8. Missing HTTPS Enforcement

**Finding:** Mixed content (HTTP + HTTPS).

**Mitigation:**
- All external resources via HTTPS
- HSTS header: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- Redirect HTTP → HTTPS at CDN level

---

## Security Best Practices

### For Developers

1. **Never trust client input** — validate server-side always
2. **Use parameterized queries** — never string concatenation
3. **Sanitize before display** — prevent XSS
4. **Check RLS policies** — test with different user contexts
5. **Log sensitive operations** — enable audit trail
6. **Use secrets for API keys** — never hardcode
7. **Review RPC logic** — ensure no privilege escalation
8. **Test AAL2 gating** — verify MFA enforcement

### For Admins

1. **Enable MFA** — for all admin accounts
2. **Rotate secrets** — quarterly (encryption keys, API keys)
3. **Monitor audit logs** — weekly review
4. **Patch dependencies** — `npm audit` monthly
5. **Review RLS policies** — after each migration
6. **Backup database** — daily automated backups
7. **Test disaster recovery** — quarterly restore tests
8. **Monitor rate limits** — adjust if needed

### For Users (Documentation)

1. **Enable MFA** — protect your account
2. **Use strong passwords** — 12+ chars, unique
3. **Don't share credentials** — even with family
4. **Review access logs** — check medical record access
5. **Revoke consent** — remove doctor access when done
6. **Report suspicious activity** — contact admin immediately


---

## Incident Response

### Security Incident Classification

| Severity | Examples | Response Time |
|----------|----------|---------------|
| **Critical** | Data breach, RCE, auth bypass | Immediate (< 1 hour) |
| **High** | XSS, CSRF, privilege escalation | < 4 hours |
| **Medium** | Info disclosure, DoS | < 24 hours |
| **Low** | Missing headers, verbose errors | < 1 week |

### Incident Response Plan

#### 1. Detection
- Automated: Supabase alerts, error monitoring (Sentry)
- Manual: User reports via security@yourdomain.com

#### 2. Containment
- **Immediate:** Rotate compromised credentials
- **Short-term:** Block malicious IPs, disable affected features
- **Long-term:** Deploy patches

#### 3. Investigation
- Review audit logs
- Identify scope (affected users/data)
- Determine attack vector

#### 4. Eradication
- Fix vulnerability (code patch + migration if needed)
- Remove backdoors/malicious code
- Verify fix in staging

#### 5. Recovery
- Deploy fix to production
- Monitor for recurrence
- Restore from backup if needed

#### 6. Post-Incident
- Document in incident log
- Notify affected users (if PII/PHI exposed)
- Update security policies
- Conduct retrospective

### Data Breach Protocol

If user data is compromised:

1. **Immediate Actions:**
   - Isolate affected systems
   - Preserve evidence (logs, backups)
   - Contact legal team

2. **Assessment:**
   - Determine data exposed (PII, PHI, passwords, etc.)
   - Identify affected users
   - Estimate timeline

3. **Notification:**
   - Users: Email within 72 hours
   - Regulators: As required by law (HIPAA, GDPR, etc.)
   - Public disclosure: If widespread impact

4. **Remediation:**
   - Force password reset for affected users
   - Offer credit monitoring (if financial data exposed)
   - Document lessons learned

### Contact Information

- **Security Team:** security@yourdomain.com
- **Admin On-Call:** admin@yourdomain.com
- **Legal:** legal@yourdomain.com

---

## Compliance

### HIPAA Considerations

**Note:** MediBook stores PHI (Protected Health Information). While Supabase can be configured for HIPAA compliance, additional steps are required:

1. **Business Associate Agreement (BAA)** with Supabase
2. **Encryption:** All PHI encrypted at rest and in transit
3. **Access Controls:** Role-based access + MFA
4. **Audit Logging:** All PHI access logged
5. **Data Retention:** Minimum 6 years
6. **Breach Notification:** Within 60 days

**Compliance Checklist:**
- [ ] BAA signed with Supabase
- [ ] All PHI fields encrypted (migration 024)
- [ ] MFA enforced for admin/doctor roles
- [ ] Audit logs enabled (migrations 021, 027)
- [ ] Data retention policy documented
- [ ] Incident response plan tested

### GDPR Considerations

**Data Subject Rights:**
- **Right to access:** User can export all their data
- **Right to rectification:** User can update profile
- **Right to erasure:** Account closure (migration 016)
- **Right to portability:** Export in JSON format

**Implementation:**
- Consent checkboxes for data processing
- Cookie banner (if using analytics)
- Data processing agreement with Supabase
- Privacy policy published

---

## Security Roadmap

### Planned Improvements

1. **Web Application Firewall (WAF)** — Cloudflare/AWS WAF
2. **Intrusion Detection System (IDS)** — Monitor for anomalies
3. **Bug Bounty Program** — HackerOne/Bugcrowd
4. **Security Automation** — SAST/DAST in CI/CD
5. **Penetration Testing** — Annual third-party audit
6. **Zero Trust Network** — Segment database access
7. **Biometric Auth** — WebAuthn/FIDO2 support

### Recent Security Updates

- **2026-01:** AAL2 gating for sensitive operations (migration 028)
- **2026-01:** Timezone-aware slot validation (migration 034)
- **2025-12:** Pentest hardening (migration 031)
- **2025-11:** PII encryption at rest (migration 024)

---

## Related Documentation

- [Architecture](./ARCHITECTURE.md) - Technical architecture and concurrency model
- [Features](./FEATURES.md) - MFA, audit logging, and security features
- [Deployment](./DEPLOYMENT.md) - Secure deployment practices
- [API Reference](./API.md) - Authentication and authorization requirements

---

**Last Updated:** January 2026  
**Security Version:** 1.0  
**Next Review:** April 2026
