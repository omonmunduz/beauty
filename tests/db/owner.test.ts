import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { asRole, book, client, createTenant, createUser, dropTenant, expectError, localSlot, uid, type TestTenant } from './helpers';

let db: pg.Client;
let A: TestTenant;
let B: TestTenant;
let ownerA: string;
let ownerB: string;

// Owner RPCs run as `authenticated` with a JWT subject, exactly like PostgREST does.
const asOwner = <T>(user: string, fn: () => Promise<T>) => asRole(db, 'authenticated', user, fn);
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = client();
  await db.connect();
  A = await createTenant(db, { masters: ['a', 'b'], services: [{ key: 's', duration: 60, buffer: 0, price: 2000, masters: ['a', 'b'] }] });
  B = await createTenant(db);
  ownerA = await createUser(db, `a-${uid()}@test.local`);
  ownerB = await createUser(db, `b-${uid()}@test.local`);
  await db.query(`insert into public.tenant_members (tenant_id, user_id) values ($1, $2), ($3, $4)`, [A.id, ownerA, B.id, ownerB]);
});
afterAll(async () => {
  await dropTenant(db, A);
  await dropTenant(db, B);
  await db.query('delete from auth.users where id = any($1)', [[ownerA, ownerB]]);
  await db.end();
});

describe('reschedule', () => {
  it('moves the booking and its occupancy atomically', async () => {
    const r = await book(db, A, { start: await localSlot(db, 'Europe/Moscow', 3, '10:00'), master: A.masters.a });
    const target = await localSlot(db, 'Europe/Moscow', 3, '12:00');
    await asOwner(ownerA, async () => {
      await db.query('select public.owner_reschedule($1, $2, null)', [r.booking_id, target]);
      const [b] = await q('select starts_at from public.bookings where id = $1', [r.booking_id]);
      const [o] = await q('select lower(period) l from public.resource_occupancies where booking_id = $1', [r.booking_id]);
      expect(new Date(b.starts_at).toISOString()).toBe(target);
      expect(new Date(o.l).toISOString()).toBe(target);
    });
  });

  it('a failed move keeps the original booking intact', async () => {
    const first = await book(db, A, { start: await localSlot(db, 'Europe/Moscow', 4, '10:00'), master: A.masters.a });
    const second = await book(db, A, { start: await localSlot(db, 'Europe/Moscow', 4, '12:00'), master: A.masters.a, phone: '+7 916 000-00-31' });
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ownerA, role: 'authenticated' })]);
    await db.query('set local role authenticated');
    try {
      await expectError(db.query('select public.owner_reschedule($1, $2, null)', [first.booking_id, await localSlot(db, 'Europe/Moscow', 4, '12:30')]), 'slot_taken');
    } finally {
      await db.query('rollback');
    }
    const [b] = await q('select starts_at from public.bookings where id = $1', [first.booking_id]);
    expect(new Date(b.starts_at).toISOString()).toBe(await localSlot(db, 'Europe/Moscow', 4, '10:00'));
    const [o] = await q('select lower(period) l from public.resource_occupancies where booking_id = $1', [first.booking_id]);
    expect(new Date(o.l).toISOString()).toBe(await localSlot(db, 'Europe/Moscow', 4, '10:00'));
    expect(second.booking_id).toBeTruthy();
  });
});

describe('blocks share the occupancy table', () => {
  it('a block hides time from booking, and cannot overlap a booking', async () => {
    const from = await localSlot(db, 'Europe/Moscow', 5, '13:00');
    const to = await localSlot(db, 'Europe/Moscow', 5, '15:00');
    await db.query('insert into public.resource_occupancies (tenant_id, resource_id, kind, period) values ($1, $2, $3, tstzrange($4, $5))', [A.id, A.masters.a, 'block', from, to]);
    await db.query('insert into public.resource_occupancies (tenant_id, resource_id, kind, period) values ($1, $2, $3, tstzrange($4, $5))', [A.id, A.masters.b, 'block', from, to]);
    await expectError(book(db, A, { start: await localSlot(db, 'Europe/Moscow', 5, '13:30') }), 'slot_taken');
    const r = await book(db, A, { start: await localSlot(db, 'Europe/Moscow', 5, '16:00'), master: A.masters.a });
    await asOwner(ownerA, async () => {
      await expectError(
        db.query('select public.owner_block_resource($1, $2, $3, $4)', [A.masters.a, await localSlot(db, 'Europe/Moscow', 5, '16:30'), await localSlot(db, 'Europe/Moscow', 5, '17:30'), 'x']),
        'slot_taken',
      );
    });
    expect(r.booking_id).toBeTruthy();
  });
});

describe('payments and statistics', () => {
  it('separates visits, completed work, received money and expected value', async () => {
    const T = await createTenant(db, { services: [{ key: 's', duration: 60, price: 3000, masters: ['m1'] }] });
    const owner = await createUser(db, `s-${uid()}@test.local`);
    await db.query('insert into public.tenant_members (tenant_id, user_id) values ($1, $2)', [T.id, owner]);
    try {
      const done = await book(db, T, { start: await localSlot(db, 'Europe/Moscow', 1, '10:00') });
      const future = await book(db, T, { start: await localSlot(db, 'Europe/Moscow', 2, '10:00'), phone: '+7 916 000-00-41' });
      await db.query('begin');
      try {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner, role: 'authenticated' })]);
      await db.query('set local role authenticated');
      await db.query('select public.owner_set_status($1, $2)', [done.booking_id, 'done']);
      await db.query('select public.owner_add_payment($1, $2, $3, $4, $5, $6)', [done.booking_id, 'payment', 3000, 'card', '', uid()]);
      await db.query('select public.owner_add_payment($1, $2, $3, $4, $5, $6)', [done.booking_id, 'refund', 500, 'card', '', uid()]);
      await db.query('savepoint s1');
      await expectError(db.query('select public.owner_add_payment($1, $2, $3, $4, $5, $6)', [done.booking_id, 'refund', 99999, 'card', '', uid()]), 'refund_exceeds_paid');
      await db.query('rollback to savepoint s1');
      const idem = uid();
      await db.query('select public.owner_add_payment($1, $2, $3, $4, $5, $6)', [future.booking_id, 'payment', 1000, 'cash', 'аванс', idem]);
      await db.query('select public.owner_add_payment($1, $2, $3, $4, $5, $6)', [future.booking_id, 'payment', 1000, 'cash', 'аванс', idem]); // replay
      const [{ s }] = (await db.query(`select public.owner_stats($1, (now() at time zone 'Europe/Moscow')::date, (now() at time zone 'Europe/Moscow')::date + 7) s`, [T.id])).rows;
      expect(s.visits).toBe(1);
      expect(s.completed).toBe(1);
      expect(Number(s.payments_total)).toBe(4000);
      expect(Number(s.refunds_total)).toBe(500);
      expect(Number(s.received)).toBe(3500);
      expect(Number(s.expected)).toBe(3000); // the future confirmed visit, reported separately from revenue
      } finally {
        await db.query('rollback');
      }
    } finally {
      await dropTenant(db, T);
      await db.query('delete from auth.users where id = $1', [owner]);
    }
  });
});

describe('tenant isolation (RLS + RPC membership)', () => {
  it('an owner sees only their own studio', async () => {
    await book(db, B, { start: await localSlot(db, 'Europe/Moscow', 3, '10:00') });
    await asOwner(ownerA, async () => {
      expect(await q('select id from public.bookings where tenant_id = $1', [B.id])).toHaveLength(0);
      expect(await q('select id from public.clients where tenant_id = $1', [B.id])).toHaveLength(0);
      expect(await q('select id from public.tenants where id = $1', [B.id])).toHaveLength(0);
      expect((await q('select id from public.bookings')).length).toBeGreaterThanOrEqual(0);
      const upd = await db.query(`update public.services set price = 1 where tenant_id = $1`, [B.id]);
      expect(upd.rowCount).toBe(0);
    });
    for (const sql of [
      [`select public.owner_schedule($1, current_date, current_date)`, [B.id]],
      [`select public.owner_stats($1, current_date, current_date)`, [B.id]],
      [`select public.owner_context($1)`, [B.slug]],
    ] as const) {
      await asOwner(ownerA, () => expectError(db.query(sql[0], [...sql[1]]), 'forbidden'));
    }
    const [bb] = await q('select id from public.bookings where tenant_id = $1 limit 1', [B.id]);
    await asOwner(ownerA, () => expectError(db.query('select public.owner_cancel_booking($1, $2)', [bb.id, 'x']), 'forbidden'));
    await asOwner(ownerA, () => expectError(db.query('select public.owner_reschedule($1, now() + interval \'3 days\', null)', [bb.id]), 'forbidden'));
  });

  it('a composite tenant FK rejects cross-tenant references', async () => {
    await expectError(
      db.query('insert into public.resource_services (tenant_id, resource_id, service_id) values ($1, $2, $3)', [A.id, A.masters.a, B.services.s1]),
      'insert or update on table "resource_services" violates foreign key constraint',
    );
  });

  it('owners cannot change protected columns (status) directly', async () => {
    await asOwner(ownerA, () => expectError(db.query(`update public.tenants set status = 'live' where id = $1`, [A.id]), 'permission denied'));
  });

  it('anon sees no tables, no personal data and no owner/service functions', async () => {
    for (const table of ['bookings', 'clients', 'payments', 'push_subscriptions', 'notification_jobs', 'tenants', 'services']) {
      await asRole(db, 'anon', null, () => expectError(db.query(`select * from public.${table} limit 1`), 'permission denied'));
    }
    for (const fn of [
      `public.owner_schedule('${A.id}', current_date, current_date)`,
      `public.claim_notification_jobs(1, 1)`,
      `public.ai_consume_quota('${A.slug}', 'x', 'client', 1, 1)`,
      `private.apply_business_config('{}'::jsonb)`,
    ]) {
      await asRole(db, 'anon', null, () => expectError(db.query(`select ${fn}`), 'permission denied'));
    }
    await asRole(db, 'authenticated', ownerA, () => expectError(db.query('select public.claim_notification_jobs(1, 1)'), 'permission denied'));
    await asRole(db, 'anon', null, () => expectError(db.query('select value from private.settings'), 'permission denied'));
  });

  it('public storefront exposes no personal data', async () => {
    const [{ s }] = await q('select public.get_storefront($1) s', [A.slug]);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/phone_norm|client|token|payment/i);
  });
});
