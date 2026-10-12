import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { book, client, createTenant, dropTenant, expectError, localSlot, uid, type TestTenant } from './helpers';

let db: pg.Client;
const tenants: TestTenant[] = [];
const track = (t: TestTenant) => (tenants.push(t), t);

beforeAll(async () => {
  db = client();
  await db.connect();
});
afterAll(async () => {
  for (const t of tenants) await dropTenant(db, t);
  await db.end();
});

describe('concurrent booking', () => {
  it('only one of many simultaneous requests gets the last free master', async () => {
    const t = track(await createTenant(db));
    const start = await localSlot(db, 'Europe/Moscow', 3, '12:00');
    const conns = await Promise.all(Array.from({ length: 6 }, async () => {
      const c = client();
      await c.connect();
      return c;
    }));
    try {
      const results = await Promise.allSettled(conns.map((c, i) => book(c, t, { start, phone: `+7 916 100-00-0${i}` })));
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(failed.every((f) => String(f.reason.message).startsWith('slot_taken'))).toBe(true);
      const { rows } = await db.query('select count(*)::int as n from public.resource_occupancies where tenant_id = $1', [t.id]);
      expect(rows[0].n).toBe(1);
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });
});

describe('two resources', () => {
  it('fills both masters for one slot, then reports slot_taken', async () => {
    const t = track(await createTenant(db, { masters: ['a', 'b'], services: [{ key: 's', duration: 60, masters: ['a', 'b'] }] }));
    const start = await localSlot(db, 'Europe/Moscow', 4, '10:00');
    const r1 = await book(db, t, { start });
    const r2 = await book(db, t, { start, phone: '+7 916 000-00-02' });
    expect(new Set([r1.resource_id, r2.resource_id]).size).toBe(2);
    await expectError(book(db, t, { start, phone: '+7 916 000-00-03' }), 'slot_taken');
    const av = await db.query('select public.get_availability($1, $2, null, ((now() at time zone $3)::date + 4), 1) as a', [t.slug, t.services.s, 'Europe/Moscow']);
    const slot = av.rows[0].a.days[0].slots.find((s: { start: string }) => new Date(s.start).toISOString() === start);
    expect(slot.free).toBe(false);
  });

  it('a specific master can be requested; the other stays free', async () => {
    const t = track(await createTenant(db, { masters: ['a', 'b'], services: [{ key: 's', duration: 30, masters: ['a', 'b'] }] }));
    const start = await localSlot(db, 'Europe/Moscow', 5, '15:00');
    const r = await book(db, t, { start, master: t.masters.b });
    expect(r.resource_id).toBe(t.masters.b);
    await expectError(book(db, t, { start, master: t.masters.b, phone: '+7 916 000-00-09' }), 'slot_taken');
    const r2 = await book(db, t, { start, master: t.masters.a, phone: '+7 916 000-00-08' });
    expect(r2.resource_id).toBe(t.masters.a);
  });
});

describe('continuous occupancy', () => {
  it('buffer keeps the master busy after the service', async () => {
    const t = track(await createTenant(db, { services: [{ key: 's', duration: 45, buffer: 15, masters: ['m1'] }] }));
    await book(db, t, { start: await localSlot(db, 'Europe/Moscow', 6, '10:00') });
    // 10:45 is inside the buffer (10:45–11:00), 11:00 is free again.
    await expectError(book(db, t, { start: await localSlot(db, 'Europe/Moscow', 6, '10:45'), phone: '+7 916 000-00-11' }), 'slot_taken');
    await expect(book(db, t, { start: await localSlot(db, 'Europe/Moscow', 6, '11:00'), phone: '+7 916 000-00-12' })).resolves.toBeTruthy();
  });

  it('a multi-day service occupies every day it spans', async () => {
    const t = track(await createTenant(db, {
      services: [
        { key: 'long', duration: 2 * 24 * 60, buffer: 60, overnight: true, masters: ['m1'] },
        { key: 'short', duration: 30, masters: ['m1'] },
      ],
    }));
    await book(db, t, { service: t.services.long, start: await localSlot(db, 'Europe/Moscow', 7, '10:00') });
    const startTs = new Date(await localSlot(db, 'Europe/Moscow', 7, '10:00')).getTime();
    const before = new Date(await localSlot(db, 'Europe/Moscow', 7, '09:30')).getTime();
    for (const day of [7, 8]) {
      const av = await db.query('select public.get_availability($1, $2, null, ((now() at time zone $3)::date + $4::int), 1) as a', [t.slug, t.services.short, 'Europe/Moscow', day]);
      const slots = av.rows[0].a.days[0].slots as { start: string; free: boolean }[];
      // Day 7 is free only for a 30-min visit that ends by 10:00; everything later (and all of day 8) is busy.
      for (const s of slots) expect(s.free).toBe(new Date(s.start).getTime() <= before && new Date(s.start).getTime() < startTs);
    }
    // Day 9: busy until 10:00 + buffer 60 = 11:00, free afterwards.
    const av = await db.query('select public.get_availability($1, $2, null, ((now() at time zone $3)::date + 9), 1) as a', [t.slug, t.services.short, 'Europe/Moscow']);
    const free = av.rows[0].a.days[0].slots.filter((s: { free: boolean }) => s.free);
    expect(free.length).toBeGreaterThan(0);
    expect(new Date(free[0].start).toISOString()).toBe(await localSlot(db, 'Europe/Moscow', 9, '11:00'));
  });

  it('starts must lie inside working hours and end before closing', async () => {
    const t = track(await createTenant(db));
    await expectError(book(db, t, { start: await localSlot(db, 'Europe/Moscow', 3, '20:30') }), 'slot_invalid'); // 60 min would end 21:30
    await expectError(book(db, t, { start: await localSlot(db, 'Europe/Moscow', 3, '08:00') }), 'slot_invalid');
    await expectError(book(db, t, { start: await localSlot(db, 'Europe/Moscow', 3, '10:07') }), 'slot_invalid'); // off-grid
  });
});

describe('timezone and exceptions', () => {
  it('uses the studio timezone for opening hours', async () => {
    const t = track(await createTenant(db, { timezone: 'Asia/Novosibirsk' }));
    const av = await db.query('select public.get_availability($1, $2, null, ((now() at time zone $3)::date + 2), 1) as a', [t.slug, Object.values(t.services)[0], 'Asia/Novosibirsk']);
    const first = av.rows[0].a.days[0].slots[0].start as string;
    expect(new Date(first).toISOString()).toBe(await localSlot(db, 'Asia/Novosibirsk', 2, '09:00'));
    expect(new Date(first).getUTCHours()).toBe(2); // 09:00 +07:00
  });

  it('a closed exception day has no slots', async () => {
    const t = track(await createTenant(db));
    await db.query(`insert into public.schedule_exceptions (tenant_id, day) values ($1, (now() at time zone 'Europe/Moscow')::date + 5)`, [t.id]);
    const av = await db.query('select public.get_availability($1, $2, null, ((now() at time zone $3)::date + 5), 1) as a', [t.slug, Object.values(t.services)[0], 'Europe/Moscow']);
    expect(av.rows[0].a.days[0]).toMatchObject({ is_open: false, slots: [] });
  });
});

describe('idempotency and tokens', () => {
  it('a retry with the same key returns the same booking and the same token', async () => {
    const t = track(await createTenant(db));
    const start = await localSlot(db, 'Europe/Moscow', 3, '13:00');
    const key = uid();
    const a = await book(db, t, { start, key });
    const b = await book(db, t, { start, key });
    expect(b.booking_id).toBe(a.booking_id);
    expect(b.token).toBe(a.token);
    expect(b.replayed).toBe(true);
    const { rows } = await db.query('select count(*)::int n from public.bookings where tenant_id = $1', [t.id]);
    expect(rows[0].n).toBe(1);
    await expectError(book(db, t, { start, key, phone: '+7 916 999-99-99' }), 'idempotency_conflict');
  });

  it('stores only a hash of the access token', async () => {
    const t = track(await createTenant(db));
    const r = await book(db, t, { start: await localSlot(db, 'Europe/Moscow', 3, '14:00') });
    const { rows } = await db.query('select encode(access_token_hash, $2) h from public.bookings where id = $1', [r.booking_id, 'hex']);
    expect(rows[0].h).not.toBe(r.token);
    expect(rows[0].h).toHaveLength(64);
    const got = await db.query('select public.get_booking($1) b', [r.token]);
    expect(got.rows[0].b.id).toBe(r.booking_id);
    await expectError(db.query('select public.get_booking($1)', ['f'.repeat(64)]), 'booking_not_found');
  });

  it('client cancellation frees the slot', async () => {
    const t = track(await createTenant(db));
    const start = await localSlot(db, 'Europe/Moscow', 3, '16:00');
    const r = await book(db, t, { start });
    await db.query('select public.cancel_booking($1)', [r.token]);
    const again = await book(db, t, { start, phone: '+7 916 000-00-77' });
    expect(again.booking_id).not.toBe(r.booking_id);
  });
});

describe('historical price', () => {
  it('changing a service price never rewrites existing bookings', async () => {
    const t = track(await createTenant(db, { services: [{ key: 's', duration: 30, price: 1500, masters: ['m1'] }] }));
    const old = await book(db, t, { start: await localSlot(db, 'Europe/Moscow', 3, '10:00') });
    await db.query(`update public.services set price = 2500, name = 'Renamed' where id = $1`, [t.services.s]);
    const fresh = await book(db, t, { start: await localSlot(db, 'Europe/Moscow', 3, '11:00'), phone: '+7 916 000-00-21' });
    const { rows } = await db.query('select id, price::float, service_name from public.bookings where tenant_id = $1', [t.id]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[old.booking_id]).toMatchObject({ price: 1500, service_name: 'Service s' });
    expect(byId[fresh.booking_id]).toMatchObject({ price: 2500, service_name: 'Renamed' });
  });
});
