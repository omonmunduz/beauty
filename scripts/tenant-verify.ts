// pnpm tenant:verify <slug> --url https://host   — black-box check of a deployed studio link.
// Verifies the shell, deep links, manifest identity, icons, scoped worker and live data.
import { loadEnvFile, parseArgs } from './lib/tenants.ts';

loadEnvFile();
const { flags, positional } = parseArgs();
const slug = positional[0];
const base = String(flags.get('url') ?? 'http://localhost:4173').replace(/\/$/, '');
if (!slug) {
  console.error('Использование: pnpm tenant:verify <slug> --url https://домен');
  process.exit(1);
}
const results: { ok: boolean; name: string; detail?: string }[] = [];
const check = (ok: boolean, name: string, detail?: string) => results.push({ ok, name, detail });

async function get(p: string) {
  const res = await fetch(`${base}${p}`, { redirect: 'manual' });
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
}

const scope = `/s/${slug}/`;
try {
  for (const p of [scope, `${scope}services`, `${scope}me`, `${scope}b/x`, `${scope}owner/`]) {
    const r = await get(p);
    check(r.status === 200 && r.text.includes(`<meta name="tenant" content="${slug}">`), `оболочка ${p}`, `HTTP ${r.status}`);
  }
  const m = await get(`${scope}manifest.webmanifest`);
  const manifest = m.status === 200 ? JSON.parse(m.text) : {};
  check(manifest.id === scope && manifest.start_url === scope && manifest.scope === scope, 'manifest id/start_url/scope', `${manifest.id} ${manifest.start_url} ${manifest.scope}`);
  check(manifest.display === 'standalone', 'manifest display=standalone');
  const icons: { src: string; purpose?: string }[] = manifest.icons ?? [];
  check(icons.some((i) => i.purpose === 'maskable'), 'maskable icon объявлена');
  for (const icon of icons) {
    const r = await fetch(`${base}${icon.src}`);
    check(r.ok && (r.headers.get('content-type') ?? '').includes('image/png'), `иконка ${icon.src}`, `HTTP ${r.status}`);
  }
  for (const p of [`${scope}icons/apple-touch-icon.png`, `${scope}splash/1179x2556.png`, `/t/${slug}/hero.webp`]) {
    const r = await fetch(`${base}${p}`);
    check(r.ok, p, `HTTP ${r.status}`);
  }
  const sw = await get(`${scope}sw.js`);
  check(sw.status === 200 && /javascript/.test(sw.type) && sw.text.includes('precache'), 'service worker в scope студии', `HTTP ${sw.status} ${sw.type}`);
} catch (e) {
  check(false, 'сайт доступен', (e as Error).message);
}

const supaUrl = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
if (supaUrl && anon) {
  const res = await fetch(`${supaUrl}/rest/v1/rpc/get_storefront`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_slug: slug }),
  });
  const data = (res.ok ? await res.json() : null) as { tenant: { name: string; status: string }; services: unknown[] } | null;
  check(!!data?.tenant && data.services.length > 0, 'данные студии из Supabase', data ? `${data.tenant.name}, статус ${data.tenant.status}, услуг ${data.services.length}` : `HTTP ${res.status}`);
} else {
  check(false, 'данные студии из Supabase', 'нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} проверок не прошли` : `\nСсылка готова: ${base}${scope}`);
process.exit(failed ? 1 : 0);
