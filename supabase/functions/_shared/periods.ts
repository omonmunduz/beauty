// Calendar periods in the studio timezone. Shared verbatim by the owner UI and the AI
// assistant so "week" or "today" always means the same date range in both places.
// Pure TypeScript (no Deno/Node APIs) so it runs in the browser, edge runtime and tests.

export type PeriodKey = 'today' | 'yesterday' | 'tomorrow' | 'week' | 'last_week' | 'next_week' | 'month' | 'last_month';

export interface DateRange {
  from: string; // YYYY-MM-DD, local to the studio
  to: string; // inclusive
  label: string;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday 1 (Mon) .. 7 (Sun) of a calendar date. */
export function isoWeekday(date: string): number {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function resolvePeriod(key: PeriodKey, timeZone: string, now: Date = new Date()): DateRange {
  const today = localDate(now, timeZone);
  const monday = addDays(today, 1 - isoWeekday(today));
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const lastOfMonth = (first: string) => {
    const d = new Date(`${first}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  };
  switch (key) {
    case 'today':
      return { from: today, to: today, label: 'сегодня' };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1), label: 'вчера' };
    case 'tomorrow':
      return { from: addDays(today, 1), to: addDays(today, 1), label: 'завтра' };
    case 'week':
      return { from: monday, to: addDays(monday, 6), label: 'эта неделя' };
    case 'last_week':
      return { from: addDays(monday, -7), to: addDays(monday, -1), label: 'прошлая неделя' };
    case 'next_week':
      return { from: addDays(monday, 7), to: addDays(monday, 13), label: 'следующая неделя' };
    case 'month':
      return { from: firstOfMonth, to: lastOfMonth(firstOfMonth), label: 'этот месяц' };
    case 'last_month': {
      const d = new Date(`${firstOfMonth}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 1);
      const first = d.toISOString().slice(0, 10);
      return { from: first, to: lastOfMonth(first), label: 'прошлый месяц' };
    }
  }
}

/** Wall-clock time of an instant in the studio timezone, e.g. "14:30". */
export function localTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function humanDate(date: string, timeZone: string, now: Date = new Date()): string {
  const today = localDate(now, timeZone);
  if (date === today) return 'сегодня';
  if (date === addDays(today, 1)) return 'завтра';
  if (date === addDays(today, -1)) return 'вчера';
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}
