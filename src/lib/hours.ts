import { addDays, isoWeekday, localDate } from '@fn/periods.ts';
import type { Storefront } from './types';

const hm = (t: string) => t.slice(0, 5);

function hoursFor(sf: Storefront, date: string): { opens: string; closes: string } | null {
  const ex = sf.exceptions.find((e) => e.day === date);
  if (ex) return ex.opens && ex.closes ? { opens: hm(ex.opens), closes: hm(ex.closes) } : null;
  const wh = sf.hours.find((h) => h.weekday === isoWeekday(date));
  return wh ? { opens: hm(wh.opens), closes: hm(wh.closes) } : null;
}

/** "Открыто до 21:00" / "Откроется завтра в 10:00" in the studio's own timezone. */
export function openStatus(sf: Storefront, now = new Date()): { open: boolean; text: string } {
  const tz = sf.tenant.timezone;
  const today = localDate(now, tz);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const h = hoursFor(sf, today);
  if (h && time >= h.opens && time < h.closes) return { open: true, text: `Открыто до ${h.closes}` };
  if (h && time < h.opens) return { open: false, text: `Откроется сегодня в ${h.opens}` };
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i);
    const next = hoursFor(sf, d);
    if (next) {
      const day = i === 1 ? 'завтра' : new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
      return { open: false, text: `Откроется ${i === 1 ? day : `в ${day}`} в ${next.opens}` };
    }
  }
  return { open: false, text: 'Сейчас закрыто' };
}

export function weekTable(sf: Storefront, now = new Date()) {
  const todayWd = isoWeekday(localDate(now, sf.tenant.timezone));
  return ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'].map((day, i) => {
    const h = sf.hours.find((x) => x.weekday === i + 1);
    return { day, today: todayWd === i + 1, hours: h ? `${hm(h.opens)}–${hm(h.closes)}` : 'выходной' };
  });
}
