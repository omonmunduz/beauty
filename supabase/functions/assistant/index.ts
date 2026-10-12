// POST /functions/v1/assistant  { slug, scope: 'client'|'owner', messages: [{role, content}] }
// Client scope: anonymous, studio-public data only. Owner scope: requires the owner's JWT;
// membership is verified server-side by owner_context() before any owner tool runs.
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { runAssistant, LlmUnsupportedTools, type LlmMode } from '../_shared/ai/loop.ts';
import { createExecutor, studioContext, type Storefront } from '../_shared/ai/executor.ts';
import type { ChatMessage, CompleteFn, Scope } from '../_shared/ai/types.ts';

const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const ALLOWED_ORIGINS = env('ALLOWED_ORIGINS', '*').split(',').map((s) => s.trim());

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]!;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

function makeComplete(): CompleteFn | null {
  const baseUrl = env('LLM_BASE_URL').replace(/\/$/, '');
  const apiKey = env('LLM_API_KEY');
  const model = env('LLM_MODEL');
  if (!baseUrl || !apiKey || !model) return null;
  return async ({ messages, tools }) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map((m: ChatMessage) => ({ ...m, content: m.content ?? (m.tool_calls ? null : '') })),
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
        temperature: 0.2,
        max_tokens: Number(env('LLM_MAX_TOKENS', '600')),
      }),
      signal: AbortSignal.timeout(Number(env('LLM_TIMEOUT_MS', '20000'))),
    });
    if (!res.ok) {
      const text = await res.text();
      if (tools && res.status >= 400 && res.status < 500 && /tool|function/i.test(text)) throw new LlmUnsupportedTools(text.slice(0, 200));
      throw new Error(`llm_http_${res.status}`);
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('llm_empty');
    return { message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, totalTokens: data.usage?.total_tokens ?? 0 };
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  let body: { slug?: unknown; scope?: unknown; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid_json' }, 400);
  }
  const slug = typeof body.slug === 'string' && /^[a-z0-9-]{2,41}$/.test(body.slug) ? body.slug : null;
  const scope: Scope | null = body.scope === 'client' || body.scope === 'owner' ? body.scope : null;
  const messages = Array.isArray(body.messages)
    ? (body.messages as { role?: unknown; content?: unknown }[])
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-12)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.content as string).slice(0, 1000) }))
    : [];
  if (!slug || !scope || !messages.length || messages[messages.length - 1]!.role !== 'user') {
    return json(req, { error: 'invalid_request' }, 400);
  }

  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('authorization') ?? '';
  const ip = (req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown').split(',')[0]!.trim();

  // The caller's own identity: anon for clients, the owner's JWT for owners.
  const caller = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: scope === 'owner' && authHeader ? { Authorization: authHeader } : {} },
  });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const sfRes = await caller.rpc('get_storefront', { p_slug: slug });
  if (sfRes.error) return json(req, { error: 'tenant_not_found' }, 404);
  const storefront = sfRes.data as Storefront;

  let tenantId: string | undefined;
  if (scope === 'owner') {
    if (!authHeader.startsWith('Bearer ')) return json(req, { error: 'unauthorized' }, 401);
    const ctx = await caller.rpc('owner_context', { p_slug: slug });
    if (ctx.error) return json(req, { error: 'forbidden' }, 403);
    tenantId = ctx.data.tenant.id as string;
  }

  const quota = await admin.rpc('ai_consume_quota', {
    p_slug: slug,
    p_ip: ip,
    p_scope: scope,
    p_daily_requests: Number(env('AI_DAILY_REQUESTS', '300')),
    p_daily_tokens: Number(env('AI_DAILY_TOKENS', '400000')),
  });
  if (quota.error) return json(req, { error: 'quota_unavailable' }, 503);
  if (!quota.data.ok && quota.data.reason === 'rate_limited') return json(req, { error: 'rate_limited' }, 429);
  const llmAllowed = quota.data.ok === true;

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const r = await caller.rpc(fn, args);
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };

  try {
    const reply = await runAssistant({
      scope,
      ctx: studioContext(storefront),
      history: messages,
      execute: createExecutor({ scope, storefront, rpc, tenantId }),
      complete: llmAllowed ? makeComplete() : null,
      mode: (env('LLM_TOOL_MODE', 'auto') as LlmMode),
      maxSteps: Number(env('LLM_MAX_STEPS', '4')),
    });
    if (reply.tokens > 0) await admin.rpc('ai_record_usage', { p_tenant: storefront.tenant.id, p_tokens: reply.tokens });
    return json(req, { ...reply, budget_exhausted: !llmAllowed });
  } catch (e) {
    console.error('assistant_failed', (e as Error).message);
    return json(req, { error: 'assistant_failed' }, 502);
  }
});
