// supabase/functions/razorpay-webhook/index.ts
//
// Authoritative, server-to-server settlement for Razorpay payments.
//
// The browser handler (razorpay-verify-payment) is best-effort: if the patient
// closes the tab right after paying, that call may never run. This webhook is
// the source of truth — Razorpay calls it directly when a payment is captured,
// so the appointment is always completed even if the browser drops.
//
// Security:
//  - Verifies the webhook signature: HMAC-SHA256(rawBody, WEBHOOK_SECRET) must
//    equal the `x-razorpay-signature` header. Unsigned/forged calls are rejected.
//  - Settlement runs via mark_payment_paid_online (service-role only).
//  - Idempotent: re-delivered events are safe (receipt is preserved).
//
// DEPLOY WITH JWT VERIFICATION DISABLED (Razorpay cannot send a Supabase JWT):
//   supabase functions deploy razorpay-webhook --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RAZORPAY_WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')!

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    if (!RAZORPAY_WEBHOOK_SECRET) {
      console.error('RAZORPAY_WEBHOOK_SECRET is not set')
      return new Response('Webhook not configured', { status: 500 })
    }

    // Raw body is required for signature verification (must match byte-for-byte).
    const rawBody = await req.text()
    const signature = req.headers.get('x-razorpay-signature') || ''

    const expected = await hmacSha256Hex(RAZORPAY_WEBHOOK_SECRET, rawBody)
    if (!signature || !timingSafeEqual(expected, signature)) {
      return new Response('Invalid signature', { status: 400 })
    }

    const event = JSON.parse(rawBody)
    const type = event?.event

    // Settle on capture / order paid.
    if (type === 'payment.captured' || type === 'order.paid') {
      const entity = event?.payload?.payment?.entity ?? event?.payload?.order?.entity ?? {}
      const orderId = entity.order_id || event?.payload?.order?.entity?.id
      const paymentId = entity.id || null

      if (orderId) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        const { error } = await supabase.rpc('mark_payment_paid_online', {
          p_order_id: orderId,
          p_payment_id: paymentId,
          p_signature: 'webhook',
        })
        if (error) {
          // Returning non-2xx makes Razorpay retry, which is what we want.
          console.error('Webhook settlement failed', error.message)
          return new Response('Settlement failed', { status: 500 })
        }
      }
    }

    // Always ack handled events so Razorpay stops retrying.
    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('Webhook error', (err as Error).message)
    return new Response('error', { status: 500 })
  }
})
