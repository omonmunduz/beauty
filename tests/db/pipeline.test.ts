import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { businessSchema, toDbPayload } from '../../shared/business-schema.ts';
import { ROOT } from '../../scripts/lib/tenants.ts';
import { book, client, createUser, localSlot, uid, type TestTenant } from './helpers';

let db: pg.Client;
let slug: string;
let tenantId: string;

function config(overrides: Record<string, unknown> = {}) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tenants', 'silk-room', 'business.json'), 'utf8'));
  return toDbPayload(businessSchema.parse({ ...raw, slug, ...overrides }));
}
const apply = async (payload: unknown) =>
  (await db.query<{ id: string }>('select private.apply_business_config($1::jsonb) id', [JSON.stringify(payload)])).rows[0]!.id;

beforeAll(async () => {
  db = client();
  await db.connect();
  slug = `p-${uid().slice(0, 8)}`;
  tenantId = await apply(config());
});
afterAll(async () => {
  await db.query('delete from public.tenants where id = $1', [tenantId]);
  await db.end();
});

describe('config pipeline', () => {
  it('a new studio starts in preview and never replaces another studio', async () => {
    const { rows } = await db.query('select slug, status from public.tenants where id = $1', [tenantId]);
    expect(rows[0]).toEqual({ slug, status: 'preview' });
    const others = await db.query(`select count(*)::int n from public.tenants where slug in ('silk-room', 'laser-lab')`);
    expect(others.rows[0].n).toBe(2);
  });

  it('re-publishing keeps bookings, owner photos and owner gallery cards; updates config data', async () => {
    const svc = (await db.query('select id from public.services where tenant_id = $1 and config_key = $2', [tenantId, 'underarms'])).rows[0].id;
    const t: TestTenant = { id: tenantId, slug, services: { underarms: svc }, masters: {} };
    const r = await book(db, t, { start: await localSlot(db, 'Europe/Moscow', 3, '12:00') });
    await db.query(`update public.tenants set hero_url = 'https://cdn/owner-hero.webp', hero_source = 'owner' where id = $1`, [tenantId]);
    await db.query(`update public.gallery_items set image_url = 'https://cdn/replaced.webp', source = 'owner' where tenant_id = $1 and config_key = 'room'`, [tenantId]);
    await db.query(`insert into public.gallery_items (tenant_id, image_url, caption, source) values ($1, 'https://cdn/new.webp', 'new', 'owner')`, [tenantId]);

    const changed = config({ tagline: 'Новый слоган' });
    changed.services = changed.services.map((s) => (s.key === 'underarms' ? { ...s, price: 999 } : s)).filter((s) => s.key !== 'wax-brows');
    await apply(changed);

    const tenant = (await db.query('select tagline, hero_url, config_version from public.tenants where id = $1', [tenantId])).rows[0];
    expect(tenant).toMatchObject({ tagline: 'Новый слоган', hero_url: 'https://cdn/owner-hero.webp', config_version: 2 });
    const booking = (await db.query('select status, price::float from public.bookings where id = $1', [r.booking_id])).rows[0];
    expect(booking).toEqual({ status: 'confirmed', price: 700 });
    const price = (await db.query('select price::float from public.services where id = $1', [svc])).rows[0].price;
    expect(price).toBe(999);
    const removed = (await db.query(`select active from public.services where tenant_id = $1 and config_key = 'wax-brows'`, [tenantId])).rows[0];
    expect(removed.active).toBe(false);
    const gallery = (await db.query('select image_url, source from public.gallery_items where tenant_id = $1', [tenantId])).rows;
    expect(gallery).toContainEqual({ image_url: 'https://cdn/replaced.webp', source: 'owner' });
    expect(gallery).toContainEqual({ image_url: 'https://cdn/new.webp', source: 'owner' });
    expect(gallery.length).toBe(7);
  });

  it('go-live requires readiness and removes demo data only', async () => {
    await db.query('select private.seed_demo_bookings($1, 6)', [tenantId]);
    await expect(db.query('select private.go_live($1)', [tenantId])).rejects.toThrow(/not_ready.*no_owner/);
    const owner = await createUser(db, `live-${uid()}@test.local`);
    await db.query('insert into public.tenant_members (tenant_id, user_id) values ($1, $2)', [tenantId, owner]);
    await db.query('select private.go_live($1)', [tenantId]);
    const left = (await db.query('select count(*)::int n from public.bookings where tenant_id = $1 and is_demo', [tenantId])).rows[0].n;
    expect(left).toBe(0);
    expect((await db.query('select status from public.tenants where id = $1', [tenantId])).rows[0].status).toBe('live');
    await db.query('delete from auth.users where id = $1', [owner]);
  });

  it('rejects invalid configs before they reach the database', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tenants', 'silk-room', 'business.json'), 'utf8'));
    const bad = businessSchema.safeParse({ ...raw, timezone: 'Mars/Olympus', services: [{ ...raw.services[0], masters: ['ghost'] }] });
    expect(bad.success).toBe(false);
    const msgs = bad.error!.issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/часовой пояс/);
    expect(msgs).toMatch(/нет мастера ghost/);
  });
});
