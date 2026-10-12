// Integration helpers: talk to the real local Supabase Postgres. Each test file creates its
// own throw-away studios through the same private.apply_business_config() as production.
import crypto from 'node:crypto';
import pg from 'pg';
import { loadEnvFile, LOCAL_DB_URL } from '../../scripts/lib/tenants.ts';

loadEnvFile();
export const DB_URL = process.env.DATABASE_URL ?? LOCAL_DB_URL;

export function client() {
  return new pg.Client({ connectionString: DB_URL });
}

export const uid = () => crypto.randomUUID();

export interface TestTenant {
  id: string;
  slug: string;
  services: Record<string, string>;
  masters: Record<string, string>;
}

export async function createTenant(
  db: pg.Client,
  opts: {
    timezone?: string;
    status?: 'preview' | 'live';
    masters?: string[];
    services?: { key: string; duration: number; buffer?: number; price?: number; overnight?: boolean; masters: string[] }[];
    hours?: { weekday: number; opens: string; closes: string }[];
  } = {},
): Promise<TestTenant> {
  const slug = `t-${crypto.randomBytes(5).toString('hex')}`;
  const masters = opts.masters ?? ['m1'];
  const services = opts.services ?? [{ key: 's1', duration: 60, buffer: 0, masters }];
  const payload = {
    slug,
    name: `Test ${slug}`,
    timezone: opts.timezone ?? 'Europe/Moscow',
    accent: '#E8A598',
    phone: '+7 900 000-00-00',
    address: 'Test street 1',
    slot_step_min: 15,
    horizon_days: 90,
    min_lead_min: 0,
    cancel_hours: 12,
    hours: opts.hours ?? [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: '09:00', closes: '21:00' })),
    masters: masters.map((key) => ({ key, name: `Master ${key}` })),
    services: services.map((s) => ({
      key: s.key, category: 'Test', name: `Service ${s.key}`, duration_min: s.duration, buffer_min: s.buffer ?? 0,
      price: s.price ?? 1000, allow_overnight: s.overnight ?? false, masters: s.masters,
    })),
    gallery: [],
  };
  const { rows } = await db.query<{ id: string }>('select private.apply_business_config($1::jsonb) as id', [JSON.stringify(payload)]);
  const id = rows[0]!.id;
  if (opts.status === 'live') await db.query(`update public.tenants set status = 'live' where id = $1`, [id]);
  const svc = await db.query<{ id: string; config_key: string }>('select id, config_key from public.services where tenant_id = $1', [id]);
  const res = await db.query<{ id: string; config_key: string }>('select id, config_key from public.resources where tenant_id = $1', [id]);
  return {
    id,
    slug,
    services: Object.fromEntries(svc.rows.map((r) => [r.config_key, r.id])),
    masters: Object.fromEntries(res.rows.map((r) => [r.config_key, r.id])),
  };
}

export async function dropTenant(db: pg.Client, t: TestTenant) {
  await db.query('delete from public.tenants where id = $1', [t.id]);
}

/** A local wall-clock time `daysAhead` days from now in the tenant timezone, as ISO UTC. */
export async function localSlot(db: pg.Client, tz: string, daysAhead: number, hhmm: string): Promise<string> {
  const { rows } = await db.query<{ t: Date }>(
    `select (((now() at time zone $1)::date + $2::int) + $3::time) at time zone $1 as t`,
    [tz, daysAhead, hhmm],
  );
  return rows[0]!.t.toISOString();
}

/** Run SQL as an API role inside a transaction that is always rolled back. */
export async function asRole<T>(db: pg.Client, role: 'anon' | 'authenticated', userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, role } : { role })]);
    await db.query(`set local role ${role}`);
    return await fn();
  } finally {
    await db.query('rollback');
  }
}

export async function createUser(db: pg.Client, email: string): Promise<string> {
  const id = uid();
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`,
    [id, email],
  );
  return id;
}

export async function book(
  db: pg.Client,
  t: TestTenant,
  args: { service?: string; master?: string | null; start: string; phone?: string; key?: string },
) {
  // Unique client IP per call so the per-IP public rate limit does not interfere with tests.
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` })]);
  const { rows } = await db.query<{ r: { booking_id: string; token: string; resource_id: string; replayed: boolean; price: string } }>(
    'select public.create_booking($1, $2, $3, $4, $5, $6, $7, $8) as r',
    [t.slug, args.service ?? Object.values(t.services)[0], args.master ?? null, args.start, 'Тест', args.phone ?? '+7 916 000-00-01', '', args.key ?? uid()],
  );
  return rows[0]!.r;
}

export async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.startsWith(code)) throw new Error(`expected ${code}, got: ${msg}`);
    return;
  }
  throw new Error(`expected error ${code}, but call succeeded`);
}
