// Studio lifecycle on the shared platform domain. The domain is never removed — only a studio.
//   pnpm tenant:status                    — every studio: status, demo deadline, bookings
//   pnpm tenant:archive <slug>            — hide now (link → "studio not found"), restorable
//   pnpm tenant:restore <slug> [--days 14]— back to preview with a new demo window
//   pnpm tenant:extend <slug> --days 7    — give a preview more time before auto-archive
//   pnpm tenant:delete <slug> --confirm <slug> — erase everything: rows, uploaded photos, folder
// Prefix with BEAUTY_ENV=production (or use the prod:* scripts) to act on the cloud project.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { LOCAL_DB_URL, PUBLIC_DIR, TENANTS_DIR, loadEnvFile, parseArgs } from './lib/tenants.ts';

loadEnvFile();
const { flags, positional } = parseArgs();
const [command, slug] = positional;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? LOCAL_DB_URL });
const target = process.env.BEAUTY_ENV === 'production' ? 'ПРОД (облако)' : 'локально';

async function tenant(s: string) {
  const r = await db.query<{ id: string; status: string }>('select id, status from public.tenants where slug = $1', [s]);
  if (!r.rows[0]) throw new Error(`студия ${s} не найдена`);
  return r.rows[0];
}

await db.connect();
try {
  switch (command) {
    case 'status': {
      const { rows } = await db.query(`
        select t.slug, t.status, t.preview_expires_at, t.archived_at,
               (select count(*) from public.bookings b where b.tenant_id = t.id and not b.is_demo)::int real_bookings,
               (select count(*) from public.tenant_members m where m.tenant_id = t.id)::int owners
        from public.tenants t order by t.status, t.slug`);
      console.log(`Студии (${target}):`);
      for (const r of rows) {
        const until = r.status === 'preview' && r.preview_expires_at ? `, демо до ${new Date(r.preview_expires_at).toLocaleDateString('ru-RU')}` : '';
        const arch = r.archived_at ? `, в архиве с ${new Date(r.archived_at).toLocaleDateString('ru-RU')}` : '';
        console.log(`  ${r.slug.padEnd(20)} ${r.status.padEnd(9)} записей ${r.real_bookings}, владельцев ${r.owners}${until}${arch}`);
      }
      break;
    }
    case 'archive': {
      const t = await tenant(slug!);
      const r = await db.query('select private.archive_tenant($1) r', [t.id]);
      console.log(`✓ ${slug} в архиве (${target}): ссылка больше не открывается, демо-записей удалено: ${r.rows[0].r.demo_bookings_removed}.`);
      console.log(`  Вернуть: pnpm tenant:restore ${slug}`);
      break;
    }
    case 'restore': {
      const t = await tenant(slug!);
      const days = Number(flags.get('days') ?? 14);
      await db.query('select private.restore_tenant($1, $2)', [t.id, days]);
      console.log(`✓ ${slug} снова в демо на ${days} дн. (${target}). Демо-записи: pnpm tenant:publish ${slug}`);
      break;
    }
    case 'extend': {
      const t = await tenant(slug!);
      const days = Number(flags.get('days') ?? 7);
      if (t.status !== 'preview') throw new Error('продлевать можно только студию в демо-режиме');
      await db.query(`update public.tenants set preview_expires_at = greatest(preview_expires_at, now()) + make_interval(days => $2) where id = $1`, [t.id, days]);
      console.log(`✓ демо ${slug} продлено на ${days} дн.`);
      break;
    }
    case 'delete': {
      if (flags.get('confirm') !== slug) {
        throw new Error(`удаление необратимо. Повторите с подтверждением: pnpm tenant:delete ${slug} --confirm ${slug}`);
      }
      const t = await tenant(slug!);
      const real = (await db.query<{ n: number }>('select count(*)::int n from public.bookings where tenant_id = $1 and not is_demo', [t.id])).rows[0]!.n;
      if (real > 0 && !flags.has('force')) throw new Error(`у студии ${real} настоящих записей. Если точно удалить — добавьте --force`);
      // Owner-uploaded photos live in storage under the tenant id.
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key) {
        const storage = createClient(url, key, { auth: { persistSession: false } }).storage.from('tenant-media');
        for (const folder of ['hero', 'logo', 'masters', 'gallery']) {
          const { data } = await storage.list(`${t.id}/${folder}`, { limit: 1000 });
          if (data?.length) await storage.remove(data.map((f) => `${t.id}/${folder}/${f.name}`));
        }
      }
      const members = (await db.query<{ user_id: string }>('select user_id from public.tenant_members where tenant_id = $1', [t.id])).rows.map((r) => r.user_id);
      await db.query('delete from public.tenants where id = $1', [t.id]); // cascades to every tenant row
      // Remove owner accounts that no longer belong to any studio.
      for (const u of members) {
        const still = (await db.query('select 1 from public.tenant_members where user_id = $1', [u])).rowCount;
        if (!still) await db.query('delete from auth.users where id = $1', [u]);
      }
      if (flags.has('files')) {
        for (const dir of [path.join(TENANTS_DIR, slug!), path.join(PUBLIC_DIR, 't', slug!), path.join(PUBLIC_DIR, 's', slug!)]) fs.rmSync(dir, { recursive: true, force: true });
        console.log(`  папка tenants/${slug} удалена — пересоберите и задеплойте сайт`);
      }
      console.log(`✓ ${slug} удалена полностью (${target}). Общий домен и остальные студии не затронуты.`);
      break;
    }
    default:
      console.log('Команды: status | archive <slug> | restore <slug> | extend <slug> --days N | delete <slug> --confirm <slug> [--files] [--force]');
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
