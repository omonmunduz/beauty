import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { VStack } from '@astryxdesign/core/VStack';
import { Text } from '@astryxdesign/core/Text';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { api } from '@/lib/api';
import { addDays, fmt, fmtDate, humanDate, localDate } from '@/lib/format';
import { ErrorBlock } from '@/components/ui';

const WINDOW = 14;

export function availabilityKey(slug: string, serviceId: string, resourceId: string | null, from: string, days: number) {
  return ['availability', slug, serviceId, resourceId, from, days] as const;
}

interface Props {
  slug: string;
  serviceId: string;
  resourceId: string | null;
  timezone: string;
  horizonDays: number;
  value: string | null;
  onChange: (start: string | null, freeResourceIds: string[]) => void;
}

export function SlotPicker({ slug, serviceId, resourceId, timezone, horizonDays, value, onChange }: Props) {
  const today = localDate(new Date(), timezone);
  const [windowStart, setWindowStart] = useState(today);
  const [day, setDay] = useState<string | null>(value ? localDate(new Date(value), timezone) : null);
  const q = useQuery({
    queryKey: availabilityKey(slug, serviceId, resourceId, windowStart, WINDOW),
    queryFn: () => api.availability(slug, serviceId, resourceId, windowStart, WINDOW),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  // Pick the first day with free time once data arrives (or keep the user's choice).
  useEffect(() => {
    if (!q.data) return;
    if (day && q.data.days.some((d) => d.date === day)) return;
    const first = q.data.days.find((d) => d.slots.some((s) => s.free));
    setDay(first?.date ?? q.data.days[0]?.date ?? null);
  }, [q.data, day]);

  // A previously chosen time that became busy is dropped instead of silently kept.
  useEffect(() => {
    if (!q.data || !value) return;
    const slot = q.data.days.flatMap((d) => d.slots).find((s) => s.start === value);
    if (slot && !slot.free) onChange(null, []);
  }, [q.data, value, onChange]);

  const current = useMemo(() => q.data?.days.find((d) => d.date === day), [q.data, day]);
  const canPrev = windowStart > today;
  const canNext = addDays(windowStart, WINDOW) <= addDays(today, horizonDays);

  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} title="Не удалось загрузить расписание" />;

  return (
    <VStack gap={3}>
      <div className="date-strip" role="group" aria-label="Дата">
        {canPrev && (
          <button type="button" className="date-btn" onClick={() => setWindowStart(addDays(windowStart, -WINDOW))} aria-label="Предыдущие две недели">
            <strong>‹</strong>
          </button>
        )}
        {q.isPending
          ? Array.from({ length: 7 }, (_, i) => <Skeleton key={i} height={70} radius={4} index={i} />)
          : q.data.days.map((d) => {
              const free = d.slots.filter((s) => s.free).length;
              return (
                <button
                  key={d.date}
                  type="button"
                  className="date-btn tap"
                  aria-pressed={d.date === day}
                  disabled={!d.is_open}
                  onClick={() => setDay(d.date)}
                  aria-label={`${fmtDate(d.date, 'EEEE, d MMMM')}${d.is_open ? `, свободно ${free}` : ', выходной'}`}
                  style={{ ['--has-free' as string]: free ? 1 : 0 }}
                >
                  <small>{d.date === today ? 'сег' : fmtDate(d.date, 'EEEEEE')}</small>
                  <strong>{fmtDate(d.date, 'd')}</strong>
                  <i aria-hidden />
                </button>
              );
            })}
        {canNext && (
          <button type="button" className="date-btn" onClick={() => setWindowStart(addDays(windowStart, WINDOW))} aria-label="Следующие две недели">
            <strong>›</strong>
          </button>
        )}
      </div>

      {q.isPending ? (
        <div className="slot-grid">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} height={44} radius={3} index={i} />
          ))}
        </div>
      ) : !current || !current.is_open ? (
        <EmptyState isCompact title="Выходной день" description="Выберите другую дату." />
      ) : current.slots.length === 0 ? (
        <EmptyState isCompact title="На этот день запись закрыта" description="Ближайшее время могло пройти — выберите другую дату." />
      ) : (
        <VStack gap={2}>
          <Text type="label">
            {humanDate(current.date, timezone)[0]!.toUpperCase() + humanDate(current.date, timezone).slice(1)} · {fmtDate(current.date, 'd MMMM')}
          </Text>
          {!current.slots.some((s) => s.free) && <Text color="secondary">Всё занято — посмотрите соседние дни.</Text>}
          <div className="slot-grid" role="group" aria-label="Время">
            {current.slots.map((s) => {
              const label = fmt(s.start, timezone, 'HH:mm');
              return (
                <button
                  key={s.start}
                  type="button"
                  className="slot tap"
                  disabled={!s.free}
                  aria-pressed={value === s.start}
                  aria-label={s.free ? label : `${label}, занято`}
                  onClick={() => onChange(s.start, s.resource_ids)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="slot-legend" aria-hidden>
            <span>свободно</span>
            <span data-kind="busy">занято</span>
          </div>
        </VStack>
      )}
    </VStack>
  );
}
