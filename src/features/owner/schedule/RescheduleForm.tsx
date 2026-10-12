import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { fmt, localDate, zonedToIso } from '@/lib/format';
import type { OwnerBooking } from '@/lib/types';
import { SlotPicker } from '@/features/booking/SlotPicker';
import { useOwner } from '../OwnerRoot';
import { useCatalog } from '../catalog';

// Moving a booking is one SQL transaction: if the new time is taken the original stays put.
export function RescheduleForm({ booking: b, onDone }: { booking: OwnerBooking; onDone: () => void }) {
  const { tenant } = useOwner();
  const tz = tenant.timezone;
  const qc = useQueryClient();
  const toast = useToast();
  const catalog = useCatalog(tenant.id);
  const [resource, setResource] = useState(b.resource_id);
  const [start, setStart] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [date, setDate] = useState(localDate(new Date(b.starts_at), tz));
  const [time, setTime] = useState(fmt(b.starts_at, tz, 'HH:mm'));
  const masters = catalog.data ? catalog.data.resources.filter((r) => r.active && catalog.data.mastersOf(b.service_id).includes(r.id)) : [];

  const move = useMutation({
    mutationFn: () => {
      const target = manual ? zonedToIso(date, time, tz) : start;
      if (!target) throw new Error('Выберите время');
      return api.ownerReschedule(b.id, target, resource);
    },
    onSuccess: (r) => {
      toast({ body: `Перенесено на ${fmt(r.starts_at, tz, 'd MMMM, HH:mm')}` });
      void qc.invalidateQueries({ queryKey: ['owner', tenant.id] });
      void qc.invalidateQueries({ queryKey: ['availability', tenant.slug] });
      onDone();
    },
  });

  return (
    <VStack gap={3}>
      <Heading level={3}>Перенос записи</Heading>
      <Selector
        label="Мастер"
        value={resource}
        onChange={(v) => {
          setResource(v);
          setStart(null);
        }}
        options={(masters.length ? masters : [{ id: b.resource_id, name: b.resource_name }]).map((m) => ({ value: m.id, label: m.name }))}
      />
      <Switch label="Указать время вручную (вне сетки)" value={manual} onChange={setManual} />
      {manual ? (
        <HStack gap={2}>
          <input className="time-input" type="date" aria-label="Дата" value={date} onChange={(e) => setDate(e.target.value)} />
          <input className="time-input" type="time" aria-label="Время" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
        </HStack>
      ) : (
        <SlotPicker slug={tenant.slug} serviceId={b.service_id} resourceId={resource} timezone={tz} horizonDays={tenant.horizon_days} value={start} onChange={(s) => setStart(s)} />
      )}
      {move.isError && <Banner status="error" title="Не перенесено" description={`${errorText(move.error)} Исходная запись не изменилась.`} collapsible={false} />}
      <HStack gap={2}>
        <Button label="Перенести" variant="primary" isLoading={move.isPending} isDisabled={!manual && !start} onClick={() => move.mutate()} />
        <Button label="Назад" variant="ghost" onClick={onDone} />
      </HStack>
    </VStack>
  );
}
