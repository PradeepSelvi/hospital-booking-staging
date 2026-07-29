# MediBook Deployment Guide

Complete step-by-step guide for deploying the hospital booking system to production.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Database Deployment](#database-deployment)
- [Edge Functions Deployment](#edge-functions-deployment)
- [Frontend Deployment](#frontend-deployment)
- [Post-Deployment Configuration](#post-deployment-configuration)
- [Verification Checklist](#verification-checklist)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts

1. **Supabase Project**
   - Sign up at [supabase.com](https://supabase.com)
   - Create a new project (choose region closest to users)
   - Note down: Project URL, Anon Key, Service Role Key

2. **Razorpay Account** (for payments)
   - Sign up at [razorpay.com](https://razorpay.com)
   - Complete KYC for Live mode
   - Generate API keys (test + live)
   - Generate webhook secret

3. **NVIDIA API Key** (for AI assistant)
   - Sign up at [build.nvidia.com](https://build.nvidia.com)
   - Generate API key for NIM access

4. **Deployment Platform** (choose one)
   - Vercel (recommended for frontend)
   - Netlify
   - AWS S3 + CloudFront
   - Any static hosting service

### Local Tools

```bash
# Install Supabase CLI (for migrations and functions)
npm install -g supabase

# Install Node.js 18+ and npm
node --version  # should be 18+
npm --version

# Clone repository
git clone <your-repo-url>
cd hospital-booking
npm install
```

---

## Environment Setup

### 1. Frontend Environment Variables

Create `.env` file in project root:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Razorpay (use test keys for staging, live keys for production)
VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx

# Optional: Analytics
VITE_GA_TRACKING_ID=G-XXXXXXXXXX
```

**Security Note:** Never commit `.env` to version control. The `.env.example` template should be committed instead.

### 2. Supabase Secrets (for Edge Functions)

Set secrets via Supabase CLI or Dashboard:

```bash
# Required for all functions
supabase secrets set \
  SUPABASE_URL=https://your-project-ref.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  SUPABASE_ANON_KEY=your-anon-key

# For chat-assistant function
supabase secrets set \
  NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxx \
  ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# For Razorpay functions
supabase secrets set \
  RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx \
  RAZORPAY_KEY_SECRET=your-live-secret \
  RAZORPAY_WEBHOOK_SECRET=your-webhook-secret

# For queue-eta-notifier (if using Twilio SMS)
supabase secrets set \
  TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxx \
  TWILIO_AUTH_TOKEN=your-auth-token \
  TWILIO_PHONE_NUMBER=+1234567890
```

**Verify secrets:**
```bash
supabase secrets list
```

---

## Database Deployment

### Step 1: Link Your Supabase Project

```bash
supabase link --project-ref your-project-ref
# Enter your database password when prompted
```

### Step 2: Apply Migrations in Order

Migrations **must** be applied sequentially (001 → 034):

```bash
# Apply all migrations
supabase db push

# Or apply individually for granular control
supabase db push --file supabase/migrations/001_base_schema.sql
supabase db push --file supabase/migrations/002_profile_management.sql
# ... continue through 034
```

### Step 3: Verify Migration Status

```bash
# Check which migrations have been applied
supabase migration list

# Verify table creation
supabase db inspect
```

### Step 4: Seed Initial Data (Optional)

If you have seed data:

```bash
# Create seed file
nano supabase/seed.sql

# Run seed
psql $DATABASE_URL -f supabase/seed.sql
```

**Recommended seed data:**
- Admin user account
- Sample departments
- Sample specializations
- Test hospital/doctor (for staging)

---

## Edge Functions Deployment

### Deploy Required Functions

```bash
# 1. Chat Assistant (AI helper)
supabase functions deploy chat-assistant

# 2. Payment functions
supabase functions deploy razorpay-create-order
supabase functions deploy razorpay-verify-payment
supabase functions deploy razorpay-webhook --no-verify-jwt

# 3. Collaboration functions
supabase functions deploy collab-document
supabase functions deploy collaborate-create-account

# 4. Admin functions
supabase functions deploy admin-mfa-reset
supabase functions deploy mfa-recovery-reset

# 5. Email/SMS notifications
supabase functions deploy send-reminders
supabase functions deploy verify-email
supabase functions deploy queue-eta-notifier

# Verify deployments
supabase functions list
```

### Set Up Cron Jobs (for periodic tasks)

In Supabase Dashboard → Database → Extensions:

1. Enable `pg_cron` extension
2. Add cron jobs:

```sql
-- Send appointment reminders (daily at 8 AM IST)
SELECT cron.schedule(
  'send-reminders',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://your-project-ref.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  );
  $$
);

-- Queue ETA notifier (every 5 minutes during clinic hours)
SELECT cron.schedule(
  'queue-eta-notifier',
  '*/5 8-20 * * *',  -- 8 AM to 8 PM every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://your-project-ref.supabase.co/functions/v1/queue-eta-notifier',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  );
  $$
);
```

---

## Frontend Deployment

### Build for Production

```bash
# Install dependencies
npm install

# Run production build
npm run build

# Verify build output
ls -la dist/
```

### Deploy to Vercel (Recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod

# Or use Vercel GitHub integration (automatic deployments)
```

**Vercel Configuration (`vercel.json`):**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

### Deploy to Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=dist
```

**Netlify Configuration (`netlify.toml`):**

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

### Custom Server Deployment

```bash
# Build
npm run build

# Upload dist/ to server
rsync -avz dist/ user@yourserver:/var/www/medibook/

# Configure Nginx
sudo nano /etc/nginx/sites-available/medibook
```

**Nginx config example:**

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    root /var/www/medibook;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # SSL (use Certbot for Let's Encrypt)
    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
}
```

---

## Post-Deployment Configuration

### 1. Configure Razorpay Webhook

1. Go to Razorpay Dashboard → Settings → Webhooks
2. Create new webhook:
   - **URL:** `https://your-project-ref.supabase.co/functions/v1/razorpay-webhook`
   - **Active Events:** `payment.captured`, `order.paid`
   - **Secret:** Generate and copy to Supabase secrets
3. Test webhook with sample event

### 2. Update Supabase Auth Settings

In Supabase Dashboard → Authentication → Settings:

1. **Site URL:** `https://yourdomain.com`
2. **Redirect URLs:** Add allowed URLs for OAuth:
   ```
   https://yourdomain.com/**
   http://localhost:5173/** (for local dev)
   ```
3. **Email Templates:** Customize confirmation/reset emails
4. **OAuth Providers:** Enable Google, GitHub (add client IDs/secrets)

### 3. Configure Storage Bucket

In Supabase Dashboard → Storage:

1. Create bucket `medical-documents` (if not exist from migrations)
2. Set bucket policy:
   - **Public:** false
   - **File size limit:** 10 MB
   - **Allowed MIME types:** `application/pdf`, `image/jpeg`, `image/png`

### 4. Enable Realtime (for notifications and chat)

In Supabase Dashboard → Database → Replication:

Enable realtime for tables:
- `notifications`
- `chat_messages`
- `queue_positions`

### 5. Set Up Email Service

In Supabase Dashboard → Authentication → Email Templates:

1. Customize templates for:
   - Email confirmation
   - Password reset
   - Magic link
2. Configure SMTP (optional, for custom domain):
   - Settings → Auth → SMTP settings
   - Add SendGrid, Mailgun, or AWS SES credentials

---

## Verification Checklist

### Database Verification

- [ ] All 34 migrations applied successfully
- [ ] Tables exist: `profiles`, `appointments`, `doctors`, `slot_swap_offers`, etc.
- [ ] RLS policies enabled on all tables
- [ ] Indexes created (check with `\di` in psql)
- [ ] Functions exist: `book_appointment`, `create_swap_offer`, etc.

### Edge Functions Verification

- [ ] All functions deployed and listed in `supabase functions list`
- [ ] Secrets configured (check with `supabase secrets list`)
- [ ] Functions accessible (test with curl):
  ```bash
  curl https://your-project-ref.supabase.co/functions/v1/chat-assistant \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"message":"Hello"}'
  ```
- [ ] Webhook endpoint returns 200:
  ```bash
  curl -X POST https://your-project-ref.supabase.co/functions/v1/razorpay-webhook
  ```

### Frontend Verification

- [ ] Site loads at production URL
- [ ] Login/register works
- [ ] OAuth providers (Google, GitHub) work
- [ ] Email verification sends email
- [ ] Doctor search returns results
- [ ] Appointment booking succeeds
- [ ] Chat works (send/receive messages)
- [ ] Notifications appear in navbar
- [ ] Payments work (test with Razorpay test mode first)
- [ ] Swap market displays offers
- [ ] Queue ETA card updates

### Security Verification

- [ ] HTTPS enabled (SSL certificate valid)
- [ ] Security headers present (check with securityheaders.com)
- [ ] CAPTCHA works on register/login
- [ ] Rate limiting active (try 6+ failed logins)
- [ ] No service role key in frontend code (audit dist/assets/*.js)
- [ ] CORS configured (only production domain allowed)
- [ ] XSS protection (test with `<script>alert('xss')</script>` in inputs)

### Performance Verification

- [ ] Lighthouse score >90 (run in Chrome DevTools)
- [ ] Page load <3 seconds
- [ ] Database queries use indexes (check with `EXPLAIN ANALYZE`)
- [ ] Images optimized/compressed
- [ ] Bundle size <500 KB (check `dist/` build output)

---

## Troubleshooting

### Database Issues

**Problem:** Migration fails with "already exists" error

```bash
# Solution: Mark migration as applied manually
supabase migration repair <migration-name> --status applied
```

**Problem:** RLS policies block legitimate queries

```bash
# Solution: Check policy with auth context
SELECT auth.uid();  -- Should return user ID when logged in
SELECT * FROM appointments WHERE patient_id = auth.uid();
```

### Edge Function Issues

**Problem:** Function returns 500 Internal Server Error

```bash
# Solution: Check function logs
supabase functions logs chat-assistant --tail

# Common causes:
# - Missing secrets (check with `supabase secrets list`)
# - CORS error (verify ALLOWED_ORIGINS includes your domain)
# - Syntax error in function code
```

**Problem:** Webhook not receiving events

```bash
# Solution 1: Verify webhook URL in Razorpay dashboard
# Solution 2: Test with webhook.site to inspect payload
# Solution 3: Check webhook signature validation code
```

### Frontend Issues

**Problem:** API calls fail with 401 Unauthorized

```bash
# Solution: Check if anon key in .env matches Supabase project
# Verify key in browser console: localStorage.getItem('supabase.auth.token')
```

**Problem:** Real-time updates not working

```bash
# Solution 1: Enable realtime for table in Supabase dashboard
# Solution 2: Check subscription in browser console for errors
# Solution 3: Verify RLS policies allow SELECT for realtime
```

### Payment Issues

**Problem:** Payment succeeds but appointment not completed

```bash
# Solution 1: Check razorpay-webhook logs
supabase functions logs razorpay-webhook --tail

# Solution 2: Verify webhook signature is correct
# Solution 3: Check payments table for status
SELECT * FROM payments WHERE appointment_id = 123 ORDER BY created_at DESC;
```

---

## Rollback Procedure

If deployment fails and you need to rollback:

### Frontend Rollback

```bash
# Vercel
vercel rollback

# Netlify
netlify rollback

# Custom server
rsync -avz backups/dist-previous/ user@yourserver:/var/www/medibook/
```

### Database Rollback

```bash
# Revert specific migration
supabase db reset

# Or manually drop objects created by failed migration
psql $DATABASE_URL -c "DROP TABLE IF EXISTS problematic_table;"
```

### Edge Function Rollback

```bash
# Redeploy previous version
git checkout <previous-commit-hash>
supabase functions deploy <function-name>
```

---

## Monitoring & Maintenance

### Set Up Monitoring

1. **Supabase Dashboard:** Monitor database performance, API usage
2. **Vercel Analytics:** Track frontend performance and user behavior
3. **Sentry/LogRocket:** Error tracking and session replay
4. **UptimeRobot:** Monitor uptime and alert on downtime

### Regular Maintenance Tasks

- **Weekly:** Review error logs, check disk space
- **Monthly:** Update dependencies (`npm update`), review security advisories
- **Quarterly:** Database vacuum, index optimization, SSL certificate renewal check
- **Yearly:** Backup migration files, review and archive old audit logs

### Backup Strategy

1. **Database backups:** Supabase auto-backups (7-day retention on free plan)
2. **Manual backups:**
   ```bash
   pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
   ```
3. **Storage backups:** Periodically download `medical-documents` bucket
4. **Code backups:** Use Git tags for releases:
   ```bash
   git tag -a v1.0.0 -m "Production release 1.0.0"
   git push origin v1.0.0
   ```

---

## Production Checklist Summary

Before going live:

- [ ] All environment variables set (frontend + Supabase secrets)
- [ ] All 34 migrations applied and verified
- [ ] All edge functions deployed and tested
- [ ] Frontend deployed with HTTPS
- [ ] Razorpay Live mode enabled (KYC completed)
- [ ] Webhook configured and tested
- [ ] Email service configured (SMTP or Supabase default)
- [ ] OAuth providers configured (Google, GitHub)
- [ ] Realtime enabled for required tables
- [ ] Security headers configured
- [ ] CAPTCHA working on auth pages
- [ ] Monitoring/alerting set up
- [ ] Backup strategy in place
- [ ] Error tracking (Sentry) configured
- [ ] Load testing completed (optional but recommended)

---

## Support & Resources

- **Supabase Docs:** https://supabase.com/docs
- **Vite Docs:** https://vitejs.dev/guide/
- **Razorpay Docs:** https://razorpay.com/docs/
- **Project README:** [../README.md](../README.md)
- **Architecture Guide:** [./ARCHITECTURE.md](./ARCHITECTURE.md)
- **Security Guide:** [./SECURITY.md](./SECURITY.md)
