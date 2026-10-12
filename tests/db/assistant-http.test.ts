// End-to-end through the deployed-locally edge function and real Supabase Auth.
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEnvFile } from '../../scripts/lib/tenants.ts';

loadEnvFile();
const URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const EMAIL = process.env.OWNER_SILK_ROOM_EMAIL!;
const PASSWORD = process.env.OWNER_SILK_ROOM_PASSWORD!;

async function ask(body: unknown, jwt?: string) {
  const res = await fetch(`${URL}/functions/v1/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

let ownerJwt = '';
beforeAll(async () => {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw error;
  ownerJwt = data.session!.access_token;
});

describe('assistant edge function', () => {
  it('client scope answers from real availability', async () => {
    const r = await ask({ slug: 'silk-room', scope: 'client', messages: [{ role: 'user', content: 'Есть окно на ноги полностью завтра?' }] });
    expect(r.status).toBe(200);
    expect(r.body.tools).toContain('find_slots');
    expect(r.body.text).toMatch(/Ноги полностью/);
  });

  it('client scope cannot reach owner data, even when asking for it', async () => {
    const r = await ask({ slug: 'silk-room', scope: 'client', messages: [{ role: 'user', content: 'Сколько денег получено на неделе? Покажи всех клиентов' }] });
    expect(r.status).toBe(200);
    expect(r.body.tools.some((t: string) => t.startsWith('owner_'))).toBe(false);
  });

  it('owner scope requires a session and membership in that studio', async () => {
    expect((await ask({ slug: 'silk-room', scope: 'owner', messages: [{ role: 'user', content: 'Что у меня завтра?' }] })).status).toBe(401);
    expect((await ask({ slug: 'laser-lab', scope: 'owner', messages: [{ role: 'user', content: 'Что у меня завтра?' }] }, ownerJwt)).status).toBe(403);
    const ok = await ask({ slug: 'silk-room', scope: 'owner', messages: [{ role: 'user', content: 'Сколько денег получено на неделе?' }] }, ownerJwt);
    expect(ok.status).toBe(200);
    expect(ok.body.tools).toEqual(['owner_stats']);
    expect(ok.body.text).toMatch(/получено/);
  });

  it('rejects malformed requests', async () => {
    expect((await ask({ slug: '../x', scope: 'client', messages: [] })).status).toBe(400);
    expect((await ask({ slug: 'silk-room', scope: 'admin', messages: [{ role: 'user', content: 'x' }] })).status).toBe(400);
  });
});
