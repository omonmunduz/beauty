import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { addDays, zonedToIso } from '@/lib/format';
import { useOwner } from '../OwnerRoot';
import { useCatalog } from '../catalog';

// A block uses the same resource_occupancies table as bookings, so it can never overlap one.
export function BlockSheet({ defaultDate, onClose }: { defaultDate: string; onClose: () => void }) {
  const { tenant } = useOwner();
  const tz = tenant.timezone;
  const qc = useQueryClient();
  const toast = useToast();
  const catalog = useCatalog(tenant.id);
  const [resource, setResource] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [t1, setT1] = useState('13:00');
  const [t2, setT2] = useState('14:00');
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const start = allDay ? zonedToIso(from, '00:00', tz) : zonedToIso(from, t1, tz);
      const end = allDay ? zonedToIso(addDays(to, 1), '00:00', tz) : zonedToIso(to, t2, tz);
      return api.ownerBlock(resource, start, end, note || (allDay ? 'Выходной' : 'Перерыв'));
    },
    onSuccess: () => {
      toast({ body: 'Время заблокировано' });
      void qc.invalidateQueries({ queryKey: ['owner', tenant.id] });
      void qc.invalidateQueries({ queryKey: ['availability', tenant.slug] });
      onClose();
    },
  });

  return (
    <BottomSheet isOpen onOpenChange={(o) => !o && onClose()} label="Заблокировать время" height="hug" padding={4} purpose="form">
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>Заблокировать время</Heading>
          <Text color="secondary">Отпуск, больничный, перерыв — клиенты не смогут записаться к мастеру на это время.</Text>
        </VStack>
        <Selector
          label="Мастер"
          placeholder="Выберите мастера"
          value={resource}
          onChange={setResource}
          options={(catalog.data?.resources ?? []).filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))}
        />
        <Switch label="Целые дни" value={allDay} onChange={setAllDay} />
        <HStack gap={2} wrap="wrap">
          <input className="time-input" type="date" aria-label="С даты" value={from} onChange={(e) => setFrom(e.target.value)} />
          {!allDay && <input className="time-input" type="time" aria-label="С времени" value={t1} onChange={(e) => setT1(e.target.value)} />}
          <span className="muted">—</span>
          <input className="time-input" type="date" aria-label="По дату" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          {!allDay && <input className="time-input" type="time" aria-label="По время" value={t2} onChange={(e) => setT2(e.target.value)} />}
        </HStack>
        <TextInput label="Причина" isOptional value={note} onChange={setNote} placeholder="Например, отпуск" />
        {save.isError && <Banner status="error" title="Не заблокировано" description={errorText(save.error) + ' Если на это время есть записи — сначала перенесите их.'} collapsible={false} />}
        <Button label="Заблокировать" variant="primary" size="lg" width="100%" isDisabled={!resource} isLoading={save.isPending} onClick={() => save.mutate()} />
      </VStack>
    </BottomSheet>
  );
}
