// Called by Supabase Cron (private.invoke_push_dispatch) every minute.
// Claims due reminder jobs with a lease, sends Web Push via VAPID and records the outcome.
// Without VAPID keys it refuses to run, so jobs stay pending instead of being marked sent.
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import webpush from 'npm:web-push@3.6.7';
import { localTime, humanDate, localDate } from '../_shared/periods.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Job {
  job_id: string;
  kind: 'reminder_24h' | 'reminder_2h';
  booking: { id: string; starts_at: string; service_name: string; resource_name: string };
  tenant: { slug: string; name: string; timezone: string; address: string };
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
}

Deno.serve(async (req) => {
  if (!safeEqual(req.headers.get('x-dispatch-secret') ?? '', env('DISPATCH_SECRET'))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }
  const pub = env('VAPID_PUBLIC_KEY');
  const priv = env('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return new Response(JSON.stringify({ error: 'vapid_not_configured' }), { status: 503 });
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', pub, priv);

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const claimed = await db.rpc('claim_notification_jobs', { p_limit: 25, p_lease_seconds: 120 });
  if (claimed.error) return new Response(JSON.stringify({ error: claimed.error.message }), { status: 500 });

  const summary = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  for (const job of claimed.data as Job[]) {
    summary.claimed++;
    if (!job.subscriptions.length) {
      await db.rpc('complete_notification_job', { p_job: job.job_id, p_outcome: 'skipped', p_error: 'no_subscription' });
      summary.skipped++;
      continue;
    }
    const tz = job.tenant.timezone;
    const day = humanDate(localDate(new Date(job.booking.starts_at), tz), tz);
    const payload = JSON.stringify({
      title: job.tenant.name,
      body: `${day[0]!.toUpperCase()}${day.slice(1)} в ${localTime(job.booking.starts_at, tz)} — ${job.booking.service_name}, мастер ${job.booking.resource_name}. ${job.tenant.address}`,
      url: `/s/${job.tenant.slug}/me`,
      tag: `booking-${job.booking.id}`,
    });
    const gone: string[] = [];
    let ok = 0;
    let lastError = '';
    for (const sub of job.subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 6 * 3600, urgency: 'normal' });
        ok++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(sub.endpoint);
        lastError = `push_${status ?? 'error'}`;
      }
    }
    const outcome = ok > 0 ? 'sent' : gone.length === job.subscriptions.length ? 'skipped' : 'error';
    await db.rpc('complete_notification_job', { p_job: job.job_id, p_outcome: outcome, p_error: lastError, p_gone_endpoints: gone });
    if (outcome === 'sent') summary.sent++;
    else if (outcome === 'skipped') summary.skipped++;
    else summary.failed++;
  }
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
});
