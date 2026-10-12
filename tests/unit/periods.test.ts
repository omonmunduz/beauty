import { describe, expect, it } from 'vitest';
import { humanDate, localDate, localTime, resolvePeriod } from '@fn/periods.ts';
import { buildIcs } from '../../src/lib/ics';
import { formatPhone } from '../../src/lib/validation';

describe('studio-timezone periods (shared by UI and AI)', () => {
  const at = new Date('2026-10-11T19:30:00Z'); // Sunday 22:30 Moscow, Monday 02:30 Novosibirsk

  it('today depends on the studio timezone', () => {
    expect(localDate(at, 'Europe/Moscow')).toBe('2026-10-11');
    expect(localDate(at, 'Asia/Novosibirsk')).toBe('2026-10-12');
  });

  it('weeks start on Monday in the studio timezone', () => {
    expect(resolvePeriod('week', 'Europe/Moscow', at)).toMatchObject({ from: '2026-10-05', to: '2026-10-11' });
    expect(resolvePeriod('week', 'Asia/Novosibirsk', at)).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
    expect(resolvePeriod('last_month', 'Europe/Moscow', at)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolvePeriod('tomorrow', 'Asia/Novosibirsk', at)).toMatchObject({ from: '2026-10-13', to: '2026-10-13' });
  });

  it('formats wall-clock time and relative dates locally', () => {
    expect(localTime('2026-10-13T07:00:00Z', 'Europe/Moscow')).toBe('10:00');
    expect(localTime('2026-10-13T07:00:00Z', 'Asia/Novosibirsk')).toBe('14:00');
    expect(humanDate('2026-10-12', 'Asia/Novosibirsk', at)).toBe('сегодня');
    expect(humanDate('2026-10-13', 'Asia/Novosibirsk', at)).toBe('завтра');
  });
});

describe('client helpers', () => {
  it('ICS event carries UTC times and two alarms', () => {
    const ics = buildIcs({ id: 'b1', title: 'Бикини, студия', start: '2026-10-13T07:00:00Z', end: '2026-10-13T07:45:00Z', location: 'Москва; 1', description: 'x', url: 'https://x' });
    expect(ics).toContain('DTSTART:20261013T070000Z');
    expect(ics).toContain('DTEND:20261013T074500Z');
    expect(ics).toContain('SUMMARY:Бикини\\, студия');
    expect(ics).toContain('LOCATION:Москва\\; 1');
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
  });

  it('normalizes Russian phone numbers', () => {
    expect(formatPhone('89161234567')).toBe('+7 (916) 123-45-67');
    expect(formatPhone('9161234567')).toBe('+7 (916) 123-45-67');
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
  });
});
