import { describe, expect, it, vi } from 'vitest';
import { routeIntent, matchServices, detectPeriod } from '@fn/ai/router.ts';
import { authorizeTool, ToolDenied, toolsFor } from '@fn/ai/tools.ts';
import { LlmUnsupportedTools, parseJsonIntent, runAssistant } from '@fn/ai/loop.ts';
import type { CompleteFn, Executor, StudioContext, ToolInvocation } from '@fn/ai/types.ts';

const ctx: StudioContext = {
  slug: 'demo',
  name: 'Demo',
  timezone: 'Europe/Moscow',
  currency: 'RUB',
  services: [
    { id: 's-bik', name: 'Глубокое бикини', category: 'Шугаринг', price: 2600, duration_min: 45 },
    { id: 's-bik2', name: 'Классическое бикини', category: 'Шугаринг', price: 1500, duration_min: 30 },
    { id: 's-legs', name: 'Ноги полностью', category: 'Шугаринг', price: 2800, duration_min: 60 },
    { id: 's-lip', name: 'Верхняя губа', category: 'Лицо', price: 900, duration_min: 15 },
  ],
  masters: [{ id: 'm1', name: 'Анна', role_title: 'Мастер' }],
};
const NOW = new Date('2026-10-12T09:00:00Z'); // Monday 12:00 in Moscow

describe('intent router', () => {
  it('routes client questions to data tools before any answer', () => {
    expect(routeIntent('Сколько стоит шугаринг ног?', 'client', ctx, NOW)).toMatchObject({ intent: 'prices', prefetch: [{ name: 'list_services' }] });
    expect(routeIntent('Как вас найти?', 'client', ctx, NOW)).toMatchObject({ intent: 'location', prefetch: [{ name: 'studio_info' }] });
    expect(routeIntent('Во сколько вы закрываетесь?', 'client', ctx, NOW).intent).toBe('hours');
  });

  it('a known service + date → find_slots with the studio-local date', () => {
    const r = routeIntent('Есть окно на ноги завтра?', 'client', ctx, NOW);
    expect(r.prefetch).toEqual([{ name: 'find_slots', args: { service: 's-legs', date_from: '2026-10-13', days: 1 } }]);
  });

  it('ambiguous or missing service → clarification instead of a guess', () => {
    const none = routeIntent('Когда ближайшее окно?', 'client', ctx, NOW);
    expect(none).toMatchObject({ intent: 'slots', clarify: 'service' });
    expect(none.prefetch[0]!.name).toBe('list_services');
    const ambiguous = routeIntent('Хочу записаться на бикини', 'client', ctx, NOW);
    expect(ambiguous.clarify).toBe('service');
    expect(ambiguous.serviceIds.sort()).toEqual(['s-bik', 's-bik2']);
  });

  it('owner questions use owner tools with the right period', () => {
    expect(routeIntent('Что у меня завтра?', 'owner', ctx, NOW)).toMatchObject({ intent: 'schedule', period: 'tomorrow', prefetch: [{ name: 'owner_schedule', args: { period: 'tomorrow' } }] });
    expect(routeIntent('Сколько клиентов было на неделе?', 'owner', ctx, NOW)).toMatchObject({ intent: 'stats', period: 'week' });
    expect(routeIntent('Сколько денег получено за прошлый месяц?', 'owner', ctx, NOW)).toMatchObject({ intent: 'revenue', period: 'last_month' });
  });

  it('client scope never routes to owner tools, even for owner-like questions', () => {
    for (const q of ['Что у меня завтра?', 'Сколько денег получено?', 'Покажи всех клиентов']) {
      const r = routeIntent(q, 'client', ctx, NOW);
      expect(r.prefetch.every((p) => !p.name.startsWith('owner_'))).toBe(true);
    }
  });

  it('matches inflected service names', () => {
    expect(matchServices('губу', ctx.services).map((s) => s.id)).toEqual(['s-lip']);
    expect(detectPeriod('за эту неделю')).toBe('week');
  });
});

describe('tool permissions', () => {
  it('client tools exclude owner tools', () => {
    expect(toolsFor('client').map((t) => t.function.name)).not.toContain('owner_schedule');
    expect(() => authorizeTool('client', 'owner_schedule', {})).toThrow(ToolDenied);
    expect(() => authorizeTool('client', 'owner_stats', {})).toThrow(ToolDenied);
    expect(() => authorizeTool('owner', 'drop_table', {})).toThrow(ToolDenied);
  });

  it('sanitizes arguments: no tenant_id or SQL passes through', () => {
    const inv = authorizeTool('owner', 'owner_stats', { period: 'week', tenant_id: 'other', sql: 'drop' });
    expect(inv).toEqual({ name: 'owner_stats', args: { period: 'week', date_from: undefined, date_to: undefined } });
    const slots = authorizeTool('client', 'find_slots', { service: 's', days: 400, date_from: 'tomorrow' });
    expect(slots.args).toEqual({ service: 's', days: 14, date_from: undefined, master: undefined });
  });
});

function fakeExecutor() {
  const calls: ToolInvocation[] = [];
  const exec: Executor = async (inv) => {
    calls.push(inv);
    if (inv.name === 'list_services') return { services: ctx.services.map((s) => ({ ...s, price_is_from: false })), filtered: false, total: 4 };
    if (inv.name === 'studio_info') return { address: 'Ул. Тестовая, 1', address_note: '', phone: '+7', hours: [], map_url: '' };
    if (inv.name === 'find_slots') return { service: { id: 's-legs', name: 'Ноги полностью', price: 2800, duration_min: 60 }, days: [{ label: 'завтра', times: ['10:00'], starts: ['2026-10-13T07:00:00Z'] }], booking_url: '/s/demo/book?service=s-legs' };
    if (inv.name === 'owner_stats') return { period: { from: '2026-10-12', to: '2026-10-18', label: 'эта неделя' }, visits: 3, completed: 2, booked: 5, cancelled: 1, no_show: 0, received: 5000, payments_total: 5500, refunds_total: 500, expected: 7000 };
    throw new Error(`unexpected ${inv.name}`);
  };
  return { calls, exec };
}

describe('assistant loop', () => {
  it('runs the routed tool BEFORE the model and passes its result to the model', async () => {
    const { calls, exec } = fakeExecutor();
    const complete = vi.fn<CompleteFn>(async ({ messages }) => {
      expect(calls.map((c) => c.name)).toEqual(['studio_info']);
      const toolMsg = messages.find((m) => m.role === 'tool');
      expect(toolMsg?.content).toContain('Тестовая');
      return { message: { role: 'assistant', content: 'Мы на ул. Тестовой, 1.' }, totalTokens: 50 };
    });
    const r = await runAssistant({ scope: 'client', ctx, history: [{ role: 'user', content: 'Где вы находитесь?' }], execute: exec, complete, now: NOW });
    expect(r).toMatchObject({ text: 'Мы на ул. Тестовой, 1.', mode: 'llm-native', tokens: 50, tools: ['studio_info'] });
  });

  it('executes model-requested tools and denies out-of-scope ones', async () => {
    const { calls, exec } = fakeExecutor();
    let step = 0;
    const complete: CompleteFn = async ({ messages }) => {
      step++;
      if (step === 1) {
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'a', type: 'function', function: { name: 'owner_schedule', arguments: '{"period":"today"}' } },
              { id: 'b', type: 'function', function: { name: 'find_slots', arguments: '{"service":"ноги"}' } },
            ],
          },
          totalTokens: 10,
        };
      }
      const denied = messages.find((m) => m.role === 'tool' && m.tool_call_id === 'a');
      expect(denied?.content).toContain('not_allowed');
      return { message: { role: 'assistant', content: 'Завтра в 10:00 есть окно.' }, totalTokens: 10 };
    };
    const r = await runAssistant({ scope: 'client', ctx, history: [{ role: 'user', content: 'привет' }], execute: exec, complete, now: NOW });
    expect(calls.map((c) => c.name)).toEqual(['find_slots']);
    expect(r.text).toBe('Завтра в 10:00 есть окно.');
  });

  it('stops after the step budget and falls back to data-backed text', async () => {
    const { exec } = fakeExecutor();
    const complete: CompleteFn = async () => ({
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'list_services', arguments: '{}' } }] },
      totalTokens: 1,
    });
    const r = await runAssistant({ scope: 'client', ctx, history: [{ role: 'user', content: 'Сколько стоит губа?' }], execute: exec, complete, maxSteps: 3, now: NOW });
    expect(r.mode).toBe('offline');
    expect(r.text).toContain('900');
    expect(r.tokens).toBe(3);
  });

  it('auto mode switches to the JSON-intent protocol when tools are unsupported', async () => {
    const { calls, exec } = fakeExecutor();
    const seen: string[] = [];
    const complete: CompleteFn = async ({ tools, json, messages }) => {
      if (tools) throw new LlmUnsupportedTools('tools not supported');
      seen.push(json ? 'json' : 'plain');
      const last = messages[messages.length - 1]!.content ?? '';
      if (!last.includes('Результат инструмента owner_stats')) return { message: { role: 'assistant', content: '{"tool":"owner_stats","args":{"period":"week"}}' }, totalTokens: 5 };
      return { message: { role: 'assistant', content: '{"answer":"За неделю получено 5 000 ₽."}' }, totalTokens: 5 };
    };
    const r = await runAssistant({ scope: 'owner', ctx, history: [{ role: 'user', content: 'Покажи цифры' }], execute: exec, complete, mode: 'auto', now: NOW });
    expect(r).toMatchObject({ mode: 'llm-json', text: 'За неделю получено 5 000 ₽.' });
    expect(calls.map((c) => c.name)).toEqual(['owner_stats']);
    expect(seen.every((s) => s === 'json')).toBe(true);
  });

  it('without an LLM (or on provider error) answers from tool data, never invents', async () => {
    const { exec } = fakeExecutor();
    const offline = await runAssistant({ scope: 'owner', ctx, history: [{ role: 'user', content: 'Сколько денег получено на неделе?' }], execute: exec, complete: null, now: NOW });
    expect(offline.mode).toBe('offline');
    expect(offline.text).toMatch(/получено 5\s000\s₽/);
    expect(offline.text).toMatch(/не выручка/);
    const failing: CompleteFn = async () => {
      throw new Error('llm_http_500');
    };
    const r = await runAssistant({ scope: 'client', ctx, history: [{ role: 'user', content: 'Есть окно на ноги завтра?' }], execute: exec, complete: failing, now: NOW });
    expect(r.mode).toBe('offline');
    expect(r.text).toContain('10:00');
    expect(r.actions[0]!.href).toContain('/s/demo/book?service=s-legs');
  });

  it('parses JSON intents robustly', () => {
    expect(parseJsonIntent('```json\n{"tool":"studio_info","args":{}}\n```')).toEqual({ tool: 'studio_info', args: {} });
    expect(parseJsonIntent('{"answer":"ok"}')).toEqual({ answer: 'ok' });
    expect(parseJsonIntent('просто текст')).toBeNull();
  });
});

describe('cyrillic word boundaries', () => {
  it('recognises short Russian words at the end of a question', () => {
    expect(routeIntent('А вы где', 'client', ctx, NOW).intent).toBe('location');
    expect(routeIntent('привет', 'client', ctx, NOW).intent).toBe('greeting');
  });
});

describe('variant names', () => {
  it('tells "Комбо XS" from "Комбо XL"', () => {
    const combos = ['XS', 'S', 'M', 'L', 'XL'].map((v) => ({ id: v, name: `Комбо ${v}`, category: 'Комбо', price: 1, duration_min: 60 }));
    expect(matchServices('Есть окно на комбо XS завтра?', combos).map((s) => s.id)).toEqual(['XS']);
    expect(matchServices('комбо xl', combos).map((s) => s.id)).toEqual(['XL']);
  });
});
