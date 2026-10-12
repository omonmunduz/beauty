import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { ru } from 'date-fns/locale';

export { addDays, humanDate, isoWeekday, localDate, localTime, resolvePeriod, type PeriodKey } from '@fn/periods.ts';

// Browsers render some currencies as ISO codes ("400 KGS"); show the word people use instead.
const LOCAL_SIGN: Record<string, string> = { KGS: 'сом', UZS: 'сум', TJS: 'сомони', KZT: '₸', RUB: '₽', BYN: 'руб.' };
export function formatMoney(amount: number, currency = 'RUB'): string {
  const sign = LOCAL_SIGN[currency];
  if (sign) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount)} ${sign}`;
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export function money(amount: number, currency = 'RUB', from = false): string {
  const v = formatMoney(amount, currency);
  return from ? `от ${v}` : v;
}

/** "₽", "сом", "$" — the studio currency's short sign for labels like "Цена, сом". */
export function currencySign(currency: string): string {
  if (LOCAL_SIGN[currency]) return LOCAL_SIGN[currency]!;
  const part = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? currency;
}

export function priceLabel(price: number, currency: string, isFrom = false): string {
  if (price === 0 && !isFrom) return 'Бесплатно';
  return money(price, currency, isFrom);
}

export function duration(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}`;
  }
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function fmt(iso: string, tz: string, pattern: string): string {
  return formatInTimeZone(new Date(iso), tz, pattern, { locale: ru });
}

/** "пн, 13 октября" for a local YYYY-MM-DD date. */
export function fmtDate(date: string, pattern = 'EEEEEE, d MMMM'): string {
  return formatInTimeZone(new Date(`${date}T12:00:00Z`), 'UTC', pattern, { locale: ru });
}

/** Interpret a wall-clock date+time in the studio timezone as an instant. */
export function zonedToIso(date: string, time: string, tz: string): string {
  return fromZonedTime(`${date}T${time}:00`, tz).toISOString();
}

export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
