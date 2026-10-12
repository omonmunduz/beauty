import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';
import { Text } from '@astryxdesign/core/Text';
import { CheckCircle } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { forgetBooking, savedBookings } from '@/lib/storage';
import { ErrorBlock, LoadingBlock } from '@/components/ui';
import { BOOKINGS_CHANGED } from '@/features/studio/StudioLayout';
import { useSlug, useStudio } from '@/features/studio/StudioRoot';
import { InstallHint } from './InstallHint';
import { BookingTicket } from './BookingTicket';

function subscribe(cb: () => void) {
  window.addEventListener(BOOKINGS_CHANGED, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(BOOKINGS_CHANGED, cb);
    window.removeEventListener('storage', cb);
  };
}

export function MyBookingsPage() {
  const slug = useSlug();
  const { tenant } = useStudio();
  const [params] = useSearchParams();
  const highlight = params.get('b');
  const isNew = params.get('new') === '1';
  const raw = useSyncExternalStore(subscribe, () => JSON.stringify(savedBookings(slug)));
  const saved = useMemo(() => JSON.parse(raw) as ReturnType<typeof savedBookings>, [raw]);

  const results = useQueries({
    queries: saved.map((b) => ({ queryKey: ['booking', b.token], queryFn: () => api.booking(b.token), staleTime: 15_000 })),
  });

  // Tokens that the server no longer recognises are dropped from this device.
  useEffect(() => {
    results.forEach((r, i) => {
      if (r.error instanceof AppError && r.error.code === 'booking_not_found') forgetBooking(slug, saved[i]!.id);
    });
  }, [results, saved, slug]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const items = saved
    .map((b, i) => ({ saved: b, q: results[i]! }))
    .sort((a, b) => {
      const now = Date.now();
      const ta = new Date(a.saved.startsAt).getTime();
      const tb = new Date(b.saved.startsAt).getTime();
      const fa = ta > now ? 0 : 1;
      const fb = tb > now ? 0 : 1;
      return fa - fb || (fa === 0 ? ta - tb : tb - ta);
    });

  return (
    <div className="section" style={{ paddingTop: 'calc(var(--safe-t) + 24px)' }}>
      <VStack gap={4}>
        <VStack gap={1}>
          <span className="eyebrow">{tenant.name}</span>
          <h1 ref={headingRef} className="section-title" style={{ fontSize: 40, margin: 0 }}>
            {isNew ? 'Вы записаны' : 'Мои записи'}
          </h1>
          {isNew && (
            <Text color="secondary">
              <CheckCircle size={18} weight="fill" className="accent-text" style={{ verticalAlign: -3, marginRight: 6 }} aria-hidden />
              Запись подтверждена. Мастер уже видит её в расписании.
            </Text>
          )}
        </VStack>

        {saved.length === 0 ? (
          <EmptyState
            title="Пока нет записей"
            description="Записи, сделанные с этого телефона, появятся здесь. Если вы записывались с другого устройства — откройте ссылку из подтверждения."
            actions={<Button label="Записаться" variant="primary" href={`/s/${slug}/book`} />}
          />
        ) : (
          items.map(({ saved: s, q }) =>
            q.isPending ? (
              <LoadingBlock key={s.id} rows={2} />
            ) : q.isError ? (
              q.error instanceof AppError && q.error.code === 'booking_not_found' ? null : (
                <ErrorBlock key={s.id} error={q.error} onRetry={() => q.refetch()} title={`${s.serviceName}: не удалось обновить`} />
              )
            ) : (
              <BookingTicket key={s.id} booking={q.data} token={s.token} highlight={s.id === highlight} />
            ),
          )
        )}
        {isNew && <InstallHint />}
        <Link to={`/s/${slug}/book`} className="accent-text" style={{ fontWeight: 700 }}>
          Записаться ещё →
        </Link>
      </VStack>
    </div>
  );
}
