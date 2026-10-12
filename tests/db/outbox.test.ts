import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { book, client, createTenant, dropTenant, localSlot, uid, type TestTenant } from './helpers';

let db: pg.Client;
let live: TestTenant;
let preview: TestTenant;
const jobs = async (bookingId: string) =>
  (await db.query('select kind, status, booking_starts_at, attempts, lease_until from public.notification_jobs where booking_id = $1 order by created_at', [bookingId])).rows;

beforeAll(async () => {
  db = client();
  await db.connect();
  live = await createTenant(db, { status: 'live' });
  preview = await createTenant(db);
});
afterAll(async () => {
  await dropTenant(db, live);
  await dropTenant(db, preview);
  await db.end();
});

describe('notification outbox', () => {
  it('a live booking enqueues one 24h reminder; preview studios enqueue nothing', async () => {
    const r = await book(db, live, { start: await localSlot(db, 'Europe/Moscow', 3, '10:00') });
    const j = await jobs(r.booking_id);
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ kind: 'reminder_24h', status: 'pending' });
    const p = await book(db, preview, { start: await localSlot(db, 'Europe/Moscow', 3, '10:00') });
    expect(await jobs(p.booking_id)).toHaveLength(0);
  });

  it('reschedule cancels the old job and creates exactly one new one (dedupe)', async () => {
    const r = await book(db, live, { start: await localSlot(db, 'Europe/Moscow', 4, '10:00') });
    const target = await localSlot(db, 'Europe/Moscow', 5, '12:00');
    await db.query('update public.resource_occupancies set period = tstzrange($2::timestamptz, $2::timestamptz + interval \'60 minutes\') where booking_id = $1', [r.booking_id, target]);
    await db.query('update public.bookings set starts_at = $2, ends_at = $2::timestamptz + interval \'60 minutes\' where id = $1', [r.booking_id, target]);
    await db.query('select private.schedule_reminders($1)', [r.booking_id]);
    await db.query('select private.schedule_reminders($1)', [r.booking_id]); // idempotent
    const j = await jobs(r.booking_id);
    expect(j.map((x) => x.status)).toEqual(['cancelled', 'pending']);
    expect(new Date(j[1].booking_starts_at).toISOString()).toBe(target);
  });

  it('client cancellation cancels pending reminders', async () => {
    const r = await book(db, live, { start: await localSlot(db, 'Europe/Moscow', 6, '10:00') });
    await db.query('select public.cancel_booking($1)', [r.token]);
    expect((await jobs(r.booking_id)).map((x) => x.status)).toEqual(['cancelled']);
  });

  it('claims with a lease, never twice concurrently, and reclaims expired leases', async () => {
    const r = await book(db, live, { start: await localSlot(db, 'Europe/Moscow', 7, '10:00') });
    await db.query(`update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [r.booking_id]);
    const [c1, c2] = [client(), client()];
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      const [a, b] = await Promise.all([
        c1.query('select public.claim_notification_jobs(50, 120) j'),
        c2.query('select public.claim_notification_jobs(50, 120) j'),
      ]);
      const ids = [...a.rows[0].j, ...b.rows[0].j].filter((x: { booking: { id: string } }) => x.booking.id === r.booking_id);
      expect(ids).toHaveLength(1);
      expect((await jobs(r.booking_id))[0]).toMatchObject({ status: 'processing', attempts: 1 });

      // Worker crashed: lease expires, the job is claimed again.
      await db.query(`update public.notification_jobs set lease_until = now() - interval '1 second' where booking_id = $1`, [r.booking_id]);
      const again = (await db.query('select public.claim_notification_jobs(50, 120) j')).rows[0].j.filter((x: { booking: { id: string } }) => x.booking.id === r.booking_id);
      expect(again).toHaveLength(1);
      expect(again[0].attempts).toBe(2);

      await db.query(`select public.complete_notification_job($1, 'sent')`, [again[0].job_id]);
      await db.query(`select public.complete_notification_job($1, 'error', 'late duplicate')`, [again[0].job_id]); // ignored
      expect((await jobs(r.booking_id))[0]).toMatchObject({ status: 'sent' });
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });

  it('a stale job for a moved booking is closed instead of sent', async () => {
    const r = await book(db, live, { start: await localSlot(db, 'Europe/Moscow', 8, '10:00') });
    // Simulate a move that bypassed schedule_reminders: the job's start no longer matches.
    await db.query(`update public.bookings set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = $1`, [r.booking_id]);
    await db.query(`update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [r.booking_id]);
    const claimed = (await db.query('select public.claim_notification_jobs(50, 120) j')).rows[0].j.filter((x: { booking: { id: string } }) => x.booking.id === r.booking_id);
    expect(claimed).toHaveLength(0);
    expect((await jobs(r.booking_id))[0].status).toBe('cancelled');
  });

  it('failed sends retry with backoff and stop after 5 attempts', async () => {
    const r = await book(db, live, { start: await localSlot(db, 'Europe/Moscow', 9, '10:00') });
    for (let i = 1; i <= 5; i++) {
      await db.query(`update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [r.booking_id]);
      const c = (await db.query('select public.claim_notification_jobs(50, 120) j')).rows[0].j.find((x: { booking: { id: string } }) => x.booking.id === r.booking_id);
      await db.query(`select public.complete_notification_job($1, 'error', 'push_500')`, [c.job_id]);
    }
    expect((await jobs(r.booking_id))[0]).toMatchObject({ status: 'failed', attempts: 5 });
  });
});

describe('push subscription by token', () => {
  it('stores a subscription only for the booking that owns the token', async () => {
    const r = await book(db, live, { start: await localSlot(db, 'Europe/Moscow', 10, '10:00') });
    await db.query('select public.save_push_subscription($1, $2, $3, $4)', [r.token, `https://push.example.com/${uid()}`, 'p256dh', 'auth']);
    const { rows } = await db.query('select tenant_id, booking_id from public.push_subscriptions where booking_id = $1', [r.booking_id]);
    expect(rows).toEqual([{ tenant_id: live.id, booking_id: r.booking_id }]);
  });
});

describe('demo lifecycle', () => {
  it('an expired preview is archived automatically; a live studio never is', async () => {
    const stale = await createTenant(db);
    const launched = await createTenant(db, { status: 'live' });
    try {
      await db.query(`update public.tenants set preview_expires_at = now() - interval '1 minute' where id = $1`, [stale.id]);
      const r = await book(db, stale, { start: await localSlot(db, 'Europe/Moscow', 3, '10:00') });
      await db.query('select private.expire_previews()');
      const s = (await db.query('select status, archived_at from public.tenants where id = $1', [stale.id])).rows[0];
      expect(s.status).toBe('archived');
      expect(s.archived_at).not.toBeNull();
      expect((await db.query('select 1 from public.bookings where id = $1', [r.booking_id])).rowCount).toBe(0); // demo rows gone
      await expect(db.query('select public.get_storefront($1)', [stale.slug])).rejects.toThrow(/tenant_not_found/);
      expect((await db.query('select status, preview_expires_at from public.tenants where id = $1', [launched.id])).rows[0]).toEqual({ status: 'live', preview_expires_at: null });
    } finally {
      await dropTenant(db, stale);
      await dropTenant(db, launched);
    }
  });
});
