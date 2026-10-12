// pnpm tenant:publish <slug> [--live] [--no-demo]
// Validates the config, regenerates static assets and upserts the studio into Postgres via
// private.apply_business_config(). Re-publishing keeps bookings, payments and owner photos.
// New studios start in preview (demo data, no real notifications); --live activates after
// the server-side readiness check.
import pg from 'pg';
import { toDbPayload } from '../shared/business-schema.ts';
import { buildTenantAssets } from './lib/assets.ts';
import { LOCAL_DB_URL, loadEnvFile, loadTenant, parseArgs, printReport } from './lib/tenants.ts';

loadEnvFile();
const { flags, positional } = parseArgs();
const slug = positional[0];
if (!slug) {
  console.error('Использование: pnpm tenant:publish <slug> [--live] [--no-demo]');
  process.exit(1);
}
const r = await loadTenant(slug);
printReport(r);
if (!r.business) process.exit(1);
const b = r.business;

await buildTenantAssets(b);
console.log(`  ✓ ассеты: public/t/${slug}, public/s/${slug}`);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? LOCAL_DB_URL });
await client.connect();
try {
  await client.query('begin');
  const { rows } = await client.query<{ id: string }>('select private.apply_business_config($1::jsonb) as id', [
    JSON.stringify(toDbPayload(b)),
  ]);
  const tenantId = rows[0]!.id;
  const t = (await client.query<{ status: string; config_version: number }>('select status, config_version from public.tenants where id = $1', [tenantId])).rows[0]!;
  console.log(`  ✓ БД: ${slug} (${tenantId}), версия конфига ${t.config_version}, статус ${t.status}`);

  if (t.status === 'preview' && !flags.has('no-demo') && b.demo.bookings > 0) {
    const has = (await client.query('select 1 from public.bookings where tenant_id = $1 limit 1', [tenantId])).rowCount;
    if (!has) {
      const made = (await client.query<{ n: number }>('select private.seed_demo_bookings($1, $2) as n', [tenantId, b.demo.bookings])).rows[0]!.n;
      console.log(`  ✓ демо-записи: ${made} (помечены is_demo, удалятся при переходе в live)`);
    }
  }
  if (flags.has('live') && t.status !== 'live') {
    const problems = (await client.query<{ p: string[] }>('select private.readiness($1) as p', [tenantId])).rows[0]!.p;
    if (problems.length) {
      console.error(`  ✗ live не активирован, не готово: ${problems.join(', ')}`);
      await client.query('rollback');
      process.exit(1);
    }
    await client.query('select private.go_live($1)', [tenantId]);
    console.log('  ✓ студия переведена в live: демо-данные удалены, напоминания включены');
  }
  await client.query('commit');
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`  ✗ ${(e as Error).message}`);
  process.exit(1);
} finally {
  await client.end();
}
console.log(`\nГотово. Соберите и опубликуйте фронтенд (pnpm build → dist/), ссылка: /s/${slug}/
Проверка опубликованной ссылки: pnpm tenant:verify ${slug} --url https://<домен>`);
