// Deterministic intent router. Before the model answers anything about bookings, the server
// runs the tools this router selects and hands the results to the model. When the LLM is
// unavailable the same results are rendered by format.ts, so answers stay data-backed.
import { addDays, isoWeekday, localDate, type PeriodKey } from '../periods.ts';
import type { Scope, StudioContext, ToolInvocation } from './types.ts';

export type Intent =
  | 'slots'
  | 'prices'
  | 'location'
  | 'hours'
  | 'contacts'
  | 'masters'
  | 'schedule'
  | 'stats'
  | 'revenue'
  | 'greeting'
  | 'other';

export interface Route {
  intent: Intent;
  prefetch: ToolInvocation[];
  /** Missing parameter the assistant must ask about instead of guessing. */
  clarify?: 'service';
  serviceIds: string[];
  period?: PeriodKey;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s:-]/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['сколько', 'стоит', 'стоимость', 'цена', 'когда', 'можно', 'записаться', 'ближайшее', 'ближайшие', 'свободное', 'время', 'окно', 'окна', 'есть', 'завтра', 'сегодня', 'хочу', 'мне', 'на', 'в', 'и', 'а', 'для', 'про', 'по', 'у', 'вас', 'ли', 'что', 'это', 'запись', 'услуга', 'процедура', 'процедуру', 'неделе', 'субботу', 'воскресенье']);

// Short Latin tokens are kept for size/variant names like "Комбо XS".
const words = (s: string) => norm(s).split(' ').filter((w) => (w.length >= 3 || /^[a-z]{1,2}$/.test(w)) && !STOP.has(w));

/** Services whose name/category shares word stems with the question, best first. */
// Russian inflection: "ног" ~ "ноги", "бикини" ~ "бикини", "шугаринга" ~ "шугаринг".
function similar(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length);
  if (n < 3) return a === b;
  const need = Math.max(3, Math.min(5, n - 1));
  return a.slice(0, need) === b.slice(0, need);
}

export function matchServices(text: string, services: StudioContext['services']): StudioContext['services'] {
  const q = words(text);
  if (!q.length) return [];
  const hit = (w: string) => q.some((x) => similar(x, w));
  const scored = services
    .map((s) => {
      let score = 0;
      // Matched name words score; unmatched ones cost a little, so "ноги полностью" prefers
      // "Ноги полностью" over "Ноги полностью воском".
      for (const w of words(s.name)) score += hit(w) ? 2 : -0.5;
      for (const w of words(s.category)) if (hit(w)) score += 1;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0]!.score;
  return scored.filter((x) => x.score === top).map((x) => x.s);
}

const WEEKDAY_WORDS: [RegExp, number][] = [
  [/понедельник/, 1], [/вторник/, 2], [/сред[уa]/, 3], [/четверг/, 4], [/пятниц/, 5], [/суббот/, 6], [/воскресен/, 7],
];

/** Start date + number of days implied by the question, in the studio timezone. */
export function detectDates(text: string, timeZone: string, now: Date): { date_from?: string; days: number } {
  const t = norm(text);
  const today = localDate(now, timeZone);
  if (/послезавтра/.test(t)) return { date_from: addDays(today, 2), days: 1 };
  if (/завтра/.test(t)) return { date_from: addDays(today, 1), days: 1 };
  if (/сегодня/.test(t)) return { date_from: today, days: 1 };
  if (/выходн/.test(t)) {
    const wd = isoWeekday(today);
    const sat = wd === 7 ? today : addDays(today, (6 - wd + 7) % 7);
    return { date_from: wd === 7 ? today : sat, days: wd === 7 ? 1 : 2 };
  }
  for (const [re, n] of WEEKDAY_WORDS) {
    if (re.test(t)) {
      const diff = (n - isoWeekday(today) + 7) % 7;
      return { date_from: addDays(today, diff), days: 1 };
    }
  }
  if (/следующ[а-яё]* недел/.test(t)) {
    return { date_from: addDays(today, 8 - isoWeekday(today)), days: 7 };
  }
  return { days: 7 };
}

export function detectPeriod(text: string): PeriodKey | undefined {
  const t = norm(text);
  if (/вчера/.test(t)) return 'yesterday';
  if (/завтра/.test(t)) return 'tomorrow';
  if (/сегодня/.test(t)) return 'today';
  if (/прошл[а-яё]* недел/.test(t)) return 'last_week';
  if (/следующ[а-яё]* недел/.test(t)) return 'next_week';
  if (/недел/.test(t)) return 'week';
  if (/прошл[а-яё]* месяц/.test(t)) return 'last_month';
  if (/месяц/.test(t)) return 'month';
  return undefined;
}

const RE = {
  greeting: /^(привет|здравствуй[а-яё]*|добрый (день|вечер|утро)|хай|hello|hi)(\s|$)/,
  location: /(где(\s|$)|адрес|как (вас )?(найти|добраться|пройти|доехать)|находит|метро|карт|парковк|вход)/,
  hours: /(час[а-яё]* работ|график|во сколько (вы )?(открыва|закрыва|работа)|до скольки|работаете|выходн[а-яё]* (день|дни)|режим)/,
  contacts: /(телефон|позвон|whatsapp|ватсап|вотсап|телеграм|telegram|связат|инстаграм)/,
  prices: /(сколько стоит|стоимост|цен[аы ]|цену|прайс|почем|руб|₽|дорого|скидк)/,
  slots: /(окн|окош|свобод|ближайш|записат|записа|запишите|когда можно|время|слот|успею|попасть|есть место)/,
  masters: /(мастер|специалист|кто (делает|работает)|врач|косметолог)/,
  revenue: /(денег|деньги|выручк|получен|оплат|заработ|касс|доход|возврат)/,
  stats: /(сколько (было )?(клиент|визит|человек|запис|гост|машин)|статистик|визит|пришл|выполнен|отмен|неявк)/,
  schedule: /(что у (меня|нас)|расписан|кто (придет|записан)|запланир|записи на|записей на|какие записи|загрузк|план на)/,
};

export function routeIntent(text: string, scope: Scope, ctx: StudioContext, now: Date = new Date()): Route {
  const t = norm(text);
  const matched = matchServices(text, ctx.services);
  const serviceIds = matched.map((s) => s.id);
  const base = { serviceIds };

  if (scope === 'owner') {
    if (RE.revenue.test(t)) {
      const period = detectPeriod(text) ?? 'week';
      return { ...base, intent: 'revenue', period, prefetch: [{ name: 'owner_stats', args: { period } }] };
    }
    if (RE.stats.test(t)) {
      const period = detectPeriod(text) ?? 'week';
      return { ...base, intent: 'stats', period, prefetch: [{ name: 'owner_stats', args: { period } }] };
    }
    if (RE.schedule.test(t) || (/(сегодня|завтра|вчера)/.test(t) && !RE.slots.test(t) && !RE.prices.test(t))) {
      const period = detectPeriod(text) ?? 'today';
      return { ...base, intent: 'schedule', period, prefetch: [{ name: 'owner_schedule', args: { period } }] };
    }
  }

  if (RE.slots.test(t) && !RE.prices.test(t)) {
    const dates = detectDates(text, ctx.timezone, now);
    if (matched.length === 1) {
      return { ...base, intent: 'slots', prefetch: [{ name: 'find_slots', args: { service: matched[0]!.id, ...dates } }] };
    }
    // Unknown or ambiguous service: fetch the catalogue and ask instead of guessing.
    return {
      ...base,
      intent: 'slots',
      clarify: 'service',
      prefetch: [{ name: 'list_services', args: { query: matched.length ? text : undefined } }],
    };
  }
  if (RE.prices.test(t)) {
    return { ...base, intent: 'prices', prefetch: [{ name: 'list_services', args: { query: matched.length ? text : undefined } }] };
  }
  if (RE.location.test(t)) return { ...base, intent: 'location', prefetch: [{ name: 'studio_info', args: {} }] };
  if (RE.hours.test(t)) return { ...base, intent: 'hours', prefetch: [{ name: 'studio_info', args: {} }] };
  if (RE.contacts.test(t)) return { ...base, intent: 'contacts', prefetch: [{ name: 'studio_info', args: {} }] };
  if (RE.masters.test(t)) return { ...base, intent: 'masters', prefetch: [{ name: 'list_masters', args: {} }] };
  if (matched.length) {
    return { ...base, intent: 'prices', prefetch: [{ name: 'list_services', args: { query: text } }] };
  }
  if (RE.greeting.test(t)) return { ...base, intent: 'greeting', prefetch: [] };
  return { ...base, intent: 'other', prefetch: [] };
}
