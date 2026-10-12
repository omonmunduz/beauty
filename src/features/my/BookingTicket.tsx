import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Avatar } from '@astryxdesign/core/Avatar';
import { useToast } from '@astryxdesign/core/Toast';
import { CalendarPlus, LinkSimple, NavigationArrow, Phone } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { duration, fmt, humanDate, localDate, money, phoneHref } from '@/lib/format';
import { buildIcs, downloadIcs } from '@/lib/ics';
import type { PublicBooking } from '@/lib/types';
import { StatusBadge } from '@/components/ui';
import { ReminderControl } from './ReminderControl';

export function BookingTicket({ booking, token, highlight = false }: { booking: PublicBooking; token: string; highlight?: boolean }) {
  const tz = booking.tenant.timezone;
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const upcoming = booking.status === 'confirmed' && new Date(booking.starts_at) > new Date();
  const link = `${location.origin}/s/${booking.tenant.slug}/b/${token}`;

  const cancel = useMutation({
    mutationFn: () => api.cancelBooking(token),
    onSuccess: () => {
      setConfirmCancel(false);
      toast({ body: 'Запись отменена' });
      void qc.invalidateQueries({ queryKey: ['booking', token] });
      void qc.invalidateQueries({ queryKey: ['availability', booking.tenant.slug] });
    },
  });

  const addToCalendar = () =>
    downloadIcs(
      `zapis-${fmt(booking.starts_at, tz, 'yyyy-MM-dd-HHmm')}.ics`,
      buildIcs({
        id: booking.id,
        title: `${booking.service_name} — ${booking.tenant.name}`,
        start: booking.starts_at,
        end: booking.ends_at,
        location: booking.tenant.address,
        description: `Мастер: ${booking.resource.name}. Телефон студии: ${booking.tenant.phone}. Запись: ${link}`,
        url: link,
      }),
    );

  const copyLink = async () => {
    try {
      if (navigator.share) await navigator.share({ title: booking.tenant.name, url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast({ body: 'Ссылка на запись скопирована' });
      }
    } catch {
      /* user dismissed share sheet */
    }
  };

  const day = humanDate(localDate(new Date(booking.starts_at), tz), tz);

  return (
    <article className="ticket" aria-label={`Запись: ${booking.service_name}`} data-highlight={highlight}>
      <div className="ticket__head">
        <VStack gap={2}>
          <HStack hAlign="between" vAlign="center">
            <span className="eyebrow">{day[0]!.toUpperCase() + day.slice(1)}</span>
            <StatusBadge status={booking.status} />
          </HStack>
          <span className="ticket__time tabular">{fmt(booking.starts_at, tz, 'HH:mm')}</span>
          <Text color="secondary">{fmt(booking.starts_at, tz, 'EEEE, d MMMM')}</Text>
        </VStack>
      </div>
      <div className="ticket__body">
        <VStack gap={1}>
          <Text type="large" weight="semibold">
            {booking.service_name}
          </Text>
          <Text color="secondary">
            {money(booking.price, booking.tenant.currency)} · {duration(booking.duration_min)}
          </Text>
        </VStack>
        <HStack gap={2} vAlign="center">
          <Avatar src={booking.resource.photo_url} name={booking.resource.name} size="md" tooltip={false} />
          <VStack gap={0}>
            <Text weight="semibold">{booking.resource.name}</Text>
            <Text type="supporting">{booking.resource.role_title}</Text>
          </VStack>
        </HStack>
        <Text type="supporting">{booking.tenant.address}</Text>
        {booking.is_demo && <Banner status="warning" title="Тестовая запись" description="Студия ещё в демо-режиме: запись видна мастеру как тестовая и удалится при запуске студии." collapsible={false} />}

        {upcoming && <ReminderControl booking={booking} token={token} onCalendar={addToCalendar} />}

        <HStack gap={2} wrap="wrap">
          {upcoming && <Button label="В календарь" icon={<CalendarPlus size={18} />} onClick={addToCalendar} size="sm" />}
          {booking.tenant.map_url && <Button label="Маршрут" icon={<NavigationArrow size={18} />} href={booking.tenant.map_url} target="_blank" rel="noopener noreferrer" size="sm" />}
          {booking.tenant.phone && <Button label="Позвонить" icon={<Phone size={18} />} href={phoneHref(booking.tenant.phone)} size="sm" />}
          <Button label="Ссылка на запись" icon={<LinkSimple size={18} />} onClick={copyLink} size="sm" />
        </HStack>

        {booking.status === 'confirmed' &&
          (booking.can_cancel ? (
            <Button label="Отменить запись" variant="ghost" onClick={() => setConfirmCancel(true)} />
          ) : upcoming ? (
            <Text type="supporting">
              Отменить онлайн можно было до {fmt(booking.cancel_deadline, tz, 'd MMMM, HH:mm')}. Чтобы перенести или отменить, позвоните в студию.
            </Text>
          ) : null)}
        {cancel.isError && <Banner status="error" title="Не удалось отменить" description={errorText(cancel.error)} collapsible={false} />}
      </div>
      <AlertDialog
        isOpen={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Отменить запись?"
        description={`${booking.service_name}, ${day} в ${fmt(booking.starts_at, tz, 'HH:mm')}. Время освободится для других клиентов.`}
        actionLabel="Отменить запись"
        cancelLabel="Оставить"
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate()}
      />
    </article>
  );
}
