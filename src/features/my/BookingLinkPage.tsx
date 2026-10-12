import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { saveBooking } from '@/lib/storage';
import { LoadingBlock } from '@/components/ui';
import { BOOKINGS_CHANGED } from '@/features/studio/StudioLayout';
import { useSlug } from '@/features/studio/StudioRoot';
import { BookingTicket } from './BookingTicket';

// /s/<slug>/b/<token> — the personal link to one booking. Opening it on a device remembers the
// booking there; when storage works we move to /me so the token leaves the address bar.
export function BookingLinkPage() {
  const slug = useSlug();
  const token = useParams().token ?? '';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['booking', token], queryFn: () => api.booking(token) });

  useEffect(() => {
    if (!q.data || q.data.tenant.slug !== slug) return;
    const ok = saveBooking(slug, { id: q.data.id, token, startsAt: q.data.starts_at, serviceName: q.data.service_name, savedAt: new Date().toISOString() });
    window.dispatchEvent(new Event(BOOKINGS_CHANGED));
    if (ok) navigate(`/s/${slug}/me?b=${q.data.id}${params.get('new') ? '&new=1' : ''}`, { replace: true });
  }, [q.data, slug, token, navigate, params]);

  return (
    <div className="section" style={{ paddingTop: 'calc(var(--safe-t) + 24px)' }}>
      <VStack gap={4}>
        <h1 className="section-title" style={{ fontSize: 40, margin: 0 }}>
          Ваша запись
        </h1>
        {q.isPending ? (
          <LoadingBlock rows={3} />
        ) : q.isError || q.data.tenant.slug !== slug ? (
          <EmptyState title="Запись не найдена" description={q.isError ? errorText(q.error) : 'Ссылка относится к другой студии.'} actions={<Button label="Записаться" href={`/s/${slug}/book`} variant="primary" />} />
        ) : (
          <BookingTicket booking={q.data} token={token} highlight />
        )}
      </VStack>
    </div>
  );
}
