// Tool catalogue and per-scope permissions. The model may only *request* a tool by name;
// the server validates the name against the scope and sanitizes arguments. Tenant id and SQL
// are never model inputs: the executor is bound to the authenticated request.
import type { Scope, ToolInvocation, ToolName, ToolSpec } from './types.ts';

const PERIODS = ['today', 'yesterday', 'tomorrow', 'week', 'last_week', 'next_week', 'month', 'last_month'] as const;

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  studio_info: {
    type: 'function',
    function: {
      name: 'studio_info',
      description: 'Адрес, как пройти, телефон, мессенджеры, часы работы и правила отмены студии.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  list_services: {
    type: 'function',
    function: {
      name: 'list_services',
      description: 'Услуги студии с ценами и длительностью. query — необязательный фильтр по названию/категории.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false },
    },
  },
  list_masters: {
    type: 'function',
    function: {
      name: 'list_masters',
      description: 'Мастера студии: имя, специализация, опыт.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  find_slots: {
    type: 'function',
    function: {
      name: 'find_slots',
      description:
        'Реальные свободные окна для услуги. service — id или название услуги; date_from — YYYY-MM-DD в часовом поясе студии; days — 1..14; master — id или имя мастера (необязательно).',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          date_from: { type: 'string' },
          days: { type: 'integer', minimum: 1, maximum: 14 },
          master: { type: 'string' },
        },
        required: ['service'],
        additionalProperties: false,
      },
    },
  },
  owner_schedule: {
    type: 'function',
    function: {
      name: 'owner_schedule',
      description: 'Записи студии за период (только чтение). period или date_from/date_to (YYYY-MM-DD).',
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', enum: [...PERIODS] }, date_from: { type: 'string' }, date_to: { type: 'string' } },
        additionalProperties: false,
      },
    },
  },
  owner_stats: {
    type: 'function',
    function: {
      name: 'owner_stats',
      description:
        'Статистика за период из базы: визиты (пришли), выполнено, получено денег (оплаты минус возвраты), ожидается по будущим записям (это не выручка).',
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', enum: [...PERIODS] }, date_from: { type: 'string' }, date_to: { type: 'string' } },
        additionalProperties: false,
      },
    },
  },
};

export const SCOPE_TOOLS: Record<Scope, readonly ToolName[]> = {
  client: ['studio_info', 'list_services', 'list_masters', 'find_slots'],
  owner: ['studio_info', 'list_services', 'list_masters', 'find_slots', 'owner_schedule', 'owner_stats'],
};

export function toolsFor(scope: Scope): ToolSpec[] {
  return SCOPE_TOOLS[scope].map((n) => TOOL_SPECS[n]);
}

export class ToolDenied extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

/** Permission check + argument sanitizing. Throws ToolDenied for anything outside the scope. */
export function authorizeTool(scope: Scope, name: string, rawArgs: unknown): ToolInvocation {
  if (!(SCOPE_TOOLS[scope] as readonly string[]).includes(name)) {
    throw new ToolDenied(`tool ${name} is not allowed for ${scope}`);
  }
  const a = rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : {};
  const tool = name as ToolName;
  switch (tool) {
    case 'studio_info':
    case 'list_masters':
      return { name: tool, args: {} };
    case 'list_services':
      return { name: tool, args: { query: str(a.query) } };
    case 'find_slots': {
      const service = str(a.service, 120);
      if (!service) throw new ToolDenied('find_slots requires service');
      const days = Number.isInteger(a.days) ? Math.min(Math.max(a.days as number, 1), 14) : 7;
      const dateFrom = str(a.date_from, 10);
      return { name: tool, args: { service, days, date_from: dateFrom && DATE.test(dateFrom) ? dateFrom : undefined, master: str(a.master) } };
    }
    case 'owner_schedule':
    case 'owner_stats': {
      const period = (PERIODS as readonly string[]).includes(a.period as string) ? (a.period as string) : undefined;
      const from = str(a.date_from, 10);
      const to = str(a.date_to, 10);
      return {
        name: tool,
        args: {
          period,
          date_from: from && DATE.test(from) ? from : undefined,
          date_to: to && DATE.test(to) ? to : undefined,
        },
      };
    }
  }
}
