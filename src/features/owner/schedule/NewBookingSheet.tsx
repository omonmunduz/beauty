import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { api } from '@/lib/api';
import { AppError, errorText } from '@/lib/errors';
import { fmt, priceLabel, zonedToIso } from '@/lib/format';
import { contactSchema, fieldErrors } from '@/lib/validation';
import { PhoneInput, phoneExample } from '@/components/fields';
import { LoadingBlock, useIdempotencyKey } from '@/components/ui';
import { SlotPicker } from '@/features/booking/SlotPicker';
import { useOwner } from '../OwnerRoot';
import { useCatalog } from '../catalog';

export function NewBookingSheet({ defaultDate, onClose }: { defaultDate: string; onClose: () => void }) {
  const { tenant } = useOwner();
  const tz = tenant.timezone;
  const qc = useQueryClient();
  const toast = useToast();
  const catalog = useCatalog(tenant.id);
  const [serviceId, setServiceId] = useState<string>('');
  const [resourceId, setResourceId] = useState<string>('any');
  const [start, setStart] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('12:00');
  const [contact, setContact] = useState({ name: '', phone: '', notes: '' });
  const [touched, setTouched] = useState(false);
  const errors = touched ? fieldErrors(contactSchema, contact) : {};
  const target = manual ? zonedToIso(date, time, tz) : start;
  const key = useIdempotencyKey([serviceId, resourceId, target, contact.phone.replace(/\D/g, '')]);

  const services = catalog.data?.services.filter((s) => s.active) ?? [];
  const masters = catalog.data && serviceId ? catalog.data.resources.filter((r) => r.active && catalog.data.mastersOf(serviceId).includes(r.id)) : [];

  const create = useMutation({
    mutationFn: () => {
      const c = contactSchema.parse(contact);
      if (!serviceId || !target) throw new AppError('validation', 'Выберите услугу и время');
      return api.ownerCreateBooking({
        tenantId: tenant.id, serviceId, resourceId: resourceId === 'any' ? null : resourceId, startsAt: target, name: c.name, phone: c.phone, notes: c.notes, idempotencyKey: key,
      });
    },
    onSuccess: (r) => {
      toast({ body: `Запись добавлена: ${fmt(r.starts_at, tz, 'd MMMM, HH:mm')}, ${r.resource_name}` });
      void qc.invalidateQueries({ queryKey: ['owner', tenant.id] });
      void qc.invalidateQueries({ queryKey: ['availability', tenant.slug] });
      onClose();
    },
  });

  return (
    <BottomSheet isOpen onOpenChange={(o) => !o && onClose()} label="Новая запись" height="tall" padding={4} purpose="form">
      <VStack gap={4}>
        <Heading level={2}>Новая запись</Heading>
        {catalog.isPending ? (
          <LoadingBlock rows={3} />
        ) : (
          <>
            <Selector
              label="Услуга"
              hasSearch
              searchPlaceholder="Найти услугу"
              placeholder="Выберите услугу"
              value={serviceId}
              onChange={(v) => {
                setServiceId(v);
                setResourceId('any');
                setStart(null);
              }}
              options={services.map((s) => ({ value: s.id, label: s.name, description: `${priceLabel(s.price, tenant.currency, s.price_is_from)} · ${s.duration_min} мин` }))}
            />
            {serviceId && (
              <>
                <Selector
                  label="Мастер"
                  value={resourceId}
                  onChange={(v) => {
                    setResourceId(v);
                    setStart(null);
                  }}
                  options={[{ value: 'any', label: 'Любой свободный' }, ...masters.map((m) => ({ value: m.id, label: m.name }))]}
                />
                <Switch label="Время вне сетки (например, после закрытия)" value={manual} onChange={setManual} />
                {manual ? (
                  <HStack gap={2}>
                    <input className="time-input" type="date" aria-label="Дата" value={date} onChange={(e) => setDate(e.target.value)} />
                    <input className="time-input" type="time" aria-label="Время" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
                  </HStack>
                ) : (
                  <SlotPicker slug={tenant.slug} serviceId={serviceId} resourceId={resourceId === 'any' ? null : resourceId} timezone={tz} horizonDays={tenant.horizon_days} value={start} onChange={(s) => setStart(s)} />
                )}
              </>
            )}
            <TextInput label="Имя клиента" value={contact.name} onChange={(v) => setContact((c) => ({ ...c, name: v }))} status={errors.name ? { type: 'error', message: errors.name } : undefined} />
            <PhoneInput label="Телефон" placeholder={phoneExample(tenant.phone)} value={contact.phone} onChange={(v) => setContact((c) => ({ ...c, phone: v }))} status={errors.phone ? { type: 'error', message: errors.phone } : undefined} />
            <TextInput label="Комментарий" isOptional value={contact.notes} onChange={(v) => setContact((c) => ({ ...c, notes: v }))} />
            {create.isError && <Banner status="error" title="Запись не создана" description={errorText(create.error)} collapsible={false} />}
            <div className="sheet-footer">
              <Button
                label="Добавить запись"
                variant="primary"
                size="lg"
                width="100%"
                isDisabled={!serviceId || !target}
                isLoading={create.isPending}
                onClick={() => {
                  setTouched(true);
                  if (Object.keys(fieldErrors(contactSchema, contact)).length) return;
                  create.mutate();
                }}
              />
            </div>
          </>
        )}
      </VStack>
    </BottomSheet>
  );
}
