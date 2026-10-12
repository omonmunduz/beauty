import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { BellRinging } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { pushSupport, subscribePush } from '@/lib/pwa';
import type { PublicBooking } from '@/lib/types';

// Honest reminder state: we only say "reminder on" when the server stored a real push
// subscription for this booking, and we never promise push in a plain iPhone Safari tab.
export function ReminderControl({ booking, token, onCalendar }: { booking: PublicBooking; token: string; onCalendar: () => void }) {
  const qc = useQueryClient();
  const support = pushSupport();
  const enable = useMutation({
    mutationFn: async () => api.savePush(token, await subscribePush(booking.tenant.slug)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['booking', token] }),
  });

  if (!booking.reminders_enabled) {
    return (
      <Banner
        status="info"
        title="Напоминания в демо-режиме выключены"
        description="Добавьте запись в календарь — он напомнит за сутки и за 2 часа."
        collapsible={false}
        endContent={<Button label="В календарь" size="sm" onClick={onCalendar} />}
      />
    );
  }
  if (booking.push_subscribed) {
    return <Banner status="success" title="Напоминание включено" description="Пришлём уведомление за сутки до визита." collapsible={false} />;
  }
  if (!support.ok) {
    const text: Record<typeof support.reason, string> = {
      'ios-not-installed': 'На iPhone уведомления работают только у установленного приложения: «Поделиться» → «На экран Домой», затем откройте его и включите напоминание. Или добавьте запись в календарь.',
      unsupported: 'Этот браузер не поддерживает уведомления. Добавьте запись в календарь — он напомнит сам.',
      denied: 'Уведомления запрещены в настройках браузера. Разрешите их для сайта или добавьте запись в календарь.',
      'no-worker': 'Уведомления недоступны в этой версии страницы. Добавьте запись в календарь.',
      'not-configured': 'Уведомления пока не подключены студией. Добавьте запись в календарь.',
    };
    return (
      <Banner
        status="info"
        title="Напомнить о визите"
        description={text[support.reason]}
        collapsible={false}
        endContent={<Button label="В календарь" size="sm" onClick={onCalendar} />}
      />
    );
  }
  return (
    <>
      <Button label="Напомнить за сутки" icon={<BellRinging size={18} />} variant="primary" width="100%" isLoading={enable.isPending} onClick={() => enable.mutate()} />
      {enable.isError && (
        <Banner
          status="warning"
          title="Не получилось включить уведомления"
          description={(enable.error as Error).message === 'denied' ? 'Вы запретили уведомления. Можно добавить запись в календарь.' : errorText(enable.error)}
          collapsible={false}
          endContent={<Button label="В календарь" size="sm" onClick={onCalendar} />}
        />
      )}
    </>
  );
}
