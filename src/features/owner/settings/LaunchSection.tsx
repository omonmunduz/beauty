import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { ErrorBlock, LoadingBlock } from '@/components/ui';
import { ownerKey, useOwner } from '../OwnerRoot';
import { useRefreshStudio } from './SettingsSection';

const PROBLEM: Record<string, string> = {
  name_missing: 'Не указано название',
  phone_missing: 'Не указан телефон',
  address_missing: 'Не указан адрес',
  no_working_hours: 'Нет рабочих часов',
  no_services: 'Нет активных услуг',
  no_masters: 'Нет активных мастеров',
  no_owner: 'Нет владельца',
};
const describe = (p: string) => (p.startsWith('service_without_master:') ? `У услуги «${p.split(':')[1]}» нет мастера` : (PROBLEM[p] ?? p));

export function LaunchSection() {
  const { tenant } = useOwner();
  const refresh = useRefreshStudio();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ownerKey(tenant.id, 'readiness'), queryFn: () => api.ownerReadiness(tenant.id) });
  const live = useMutation({
    mutationFn: () => api.ownerGoLive(tenant.id),
    onSuccess: async () => {
      setConfirm(false);
      await refresh();
    },
  });

  if (tenant.status === 'live') {
    return <Banner status="success" title="Студия работает" description="Клиенты записываются по-настоящему, напоминания отправляются." collapsible={false} />;
  }
  if (q.isPending) return <LoadingBlock rows={3} />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const ready = q.data.length === 0;
  return (
    <VStack gap={4}>
      <Text color="secondary">
        Сейчас студия в режиме превью: записи помечены как демо, уведомления не отправляются. После запуска демо-записи удаляются, и студия начинает принимать
        настоящие записи.
      </Text>
      {ready ? (
        <Banner status="success" title="Всё готово к запуску" icon={<CheckCircle size={20} />} collapsible={false} />
      ) : (
        <Banner status="warning" title="Что нужно исправить" icon={<WarningCircle size={20} />} description={q.data.map(describe).join(' · ')} collapsible={false} />
      )}
      {live.isError && <Banner status="error" title="Не запущено" description={errorText(live.error)} collapsible={false} />}
      <Button label="Запустить студию" variant="primary" size="lg" isDisabled={!ready} onClick={() => setConfirm(true)} />
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Запустить студию?"
        description="Демо-записи и демо-оплаты будут удалены. Это действие нельзя отменить."
        actionLabel="Запустить"
        actionVariant="primary"
        cancelLabel="Отмена"
        isActionLoading={live.isPending}
        onAction={() => live.mutate()}
      />
    </VStack>
  );
}
