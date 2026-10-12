// pnpm owner:create <slug> <email> [--password <pwd>]
// There is no public owner signup: an operator creates the account with the service role
// and attaches it to exactly one studio through tenant_members.
import crypto from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { LOCAL_DB_URL, loadEnvFile, parseArgs } from './lib/tenants.ts';

loadEnvFile();
const { flags, positional } = parseArgs();
const [slug, email] = positional;
if (!slug || !email || !email.includes('@')) {
  console.error('Использование: pnpm owner:create <slug> <email> [--password <пароль>]');
  process.exit(1);
}
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (см. .env.example)');
  process.exit(1);
}
const generated = typeof flags.get('password') !== 'string';
const password = generated ? crypto.randomBytes(12).toString('base64url') : (flags.get('password') as string);

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? LOCAL_DB_URL });
await db.connect();
try {
  const tenant = (await db.query<{ id: string }>('select id from public.tenants where slug = $1', [slug])).rows[0];
  if (!tenant) throw new Error(`студия ${slug} не найдена — сначала pnpm tenant:publish ${slug}`);

  let userId = (await db.query<{ id: string }>('select id from auth.users where lower(email) = lower($1)', [email])).rows[0]?.id;
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) throw error;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
  }
  await db.query(
    `insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')
     on conflict (tenant_id, user_id) do nothing`,
    [tenant.id, userId],
  );
  console.log(`Владелец ${email} привязан к ${slug}. Вход: /s/${slug}/owner/`);
  if (generated) console.log(`Пароль (показывается один раз): ${password}`);
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
