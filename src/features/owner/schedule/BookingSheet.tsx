import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { ArrowCounterClockwise, CalendarX, Check, CheckCircle, Phone, UserCheck, UserMinus } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { currencySign, fmt, money, phoneHref } from '@/lib/format';
import type { OwnerBooking } from '@/lib/types';
import { moneySchema } from '@/lib/validation';
import { NumberField } from '@/components/fields';
import { StatusBadge, useIdempotencyKey } from '@/components/ui';
import { ownerKey, useOwner } from '../OwnerRoot';
import { RescheduleForm } from './RescheduleForm';

const METHODS = [
  { value: 'card', label: 'Карта' },
  { value: 'cash', label: 'Наличные' },
  { value: 'transfer', label: 'Перевод' },
];

export function BookingSheet({ booking: b, onClose }: { booking: OwnerBooking; onClose: () => void }) {
  const { tenant } = useOwner();
  const tz = tenant.timezone;
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'reschedule' | 'payment' | 'refund'>('view');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('card');
  const [note, setNote] = useState('');
  const paidNet = Number(b.paid) - Number(b.refunded);
  const due = Math.max(Number(b.price) - paidNet, 0);
  const payKey = useIdempotencyKey([b.id, mode, amount, method]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['owner', tenant.id] });
  const payments = useQuery({ queryKey: ownerKey(tenant.id, 'payments', b.id), queryFn: () => api.ownerPayments(b.id) });

  const status = useMutation({
    mutationFn: (s: string) => api.ownerSetStatus(b.id, s),
    onSuccess: () => refresh(),
    onError: (e) => toast({ body: errorText(e), type: 'error' }),
  });
  const cancel = useMutation({
    mutationFn: () => api.ownerCancel(b.id, 'Отменено студией'),
    onSuccess: () => {
      setCancelOpen(false);
      toast({ body: 'Запись отменена, время освобождено' });
      void refresh();
    },
  });
  const pay = useMutation({
    mutationFn: () => {
      const parsed = moneySchema.safeParse(amount.replace(',', '.').replace(/\s/g, ''));
      if (!parsed.success) throw new Error('invalid_amount');
      return api.ownerAddPayment({ bookingId: b.id, kind: mode === 'refund' ? 'refund' : 'payment', amount: parsed.data, method, note, idempotencyKey: payKey });
    },
    onSuccess: () => {
      toast({ body: mode === 'refund' ? 'Возврат записан' : 'Оплата записана' });
      setMode('view');
      setAmount('');
      setNote('');
      void refresh();
    },
  });

  const busy = status.isPending;
  return (
    <BottomSheet isOpen onOpenChange={(o) => !o && onClose()} label={`Запись: ${b.client_name}`} height="tall" padding={4} purpose={mode === 'view' ? 'info' : 'form'}>
      <VStack gap={4}>
        <VStack gap={1}>
          <HStack hAlign="between" vAlign="center">
            <span className="eyebrow">{fmt(b.starts_at, tz, 'EEEE, d MMMM')}</span>
            <StatusBadge status={b.status} />
          </HStack>
          <Heading level={2}>{b.client_name}</Heading>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text className="tabular" weight="semibold">
              {fmt(b.starts_at, tz, 'HH:mm')}–{fmt(b.ends_at, tz, 'HH:mm')}
            </Text>
            <Text color="secondary">
              · {b.service_name} · {b.resource_name}
            </Text>
          </HStack>
        </VStack>
        <HStack gap={2} wrap="wrap">
          <Button label={b.client_phone} icon={<Phone size={16} />} href={phoneHref(b.client_phone)} size="sm" />
          {b.source === 'client' ? <Text type="supporting">записалась онлайн</Text> : <Text type="supporting">добавлено вручную</Text>}
          {b.is_demo && <Text type="supporting">· демо</Text>}
        </HStack>
        {b.notes && <Banner status="info" title="Комментарий" description={b.notes} collapsible={false} />}
        {b.status === 'cancelled' && (
          <Banner status="warning" title={`Отменена ${b.cancelled_by === 'client' ? 'клиентом' : 'студией'}`} description={b.cancel_reason || undefined} collapsible={false} />
        )}

        <div className="summary">
          <div className="summary__row">
            <span>Стоимость</span>
            <span>{money(Number(b.price), tenant.currency)}</span>
          </div>
          <div className="summary__row">
            <span>Оплачено</span>
            <span>{money(paidNet, tenant.currency)}</span>
          </div>
          {due > 0 && b.status !== 'cancelled' && (
            <div className="summary__row">
              <span>К оплате</span>
              <span className="accent-text">{money(due, tenant.currency)}</span>
            </div>
          )}
        </div>

        {mode === 'view' && (
          <VStack gap={2}>
            {b.status === 'confirmed' && (
              <HStack gap={2} wrap="wrap">
                <Button label="Пришла" icon={<UserCheck size={18} />} variant="primary" isLoading={busy} onClick={() => status.mutate('arrived')} />
                <Button label="Готово" icon={<CheckCircle size={18} />} isLoading={busy} onClick={() => status.mutate('done')} />
                <Button label="Не пришла" icon={<UserMinus size={18} />} variant="ghost" isLoading={busy} onClick={() => status.mutate('no_show')} />
              </HStack>
            )}
            {b.status === 'arrived' && (
              <HStack gap={2} wrap="wrap">
                <Button label="Готово" icon={<CheckCircle size={18} />} variant="primary" isLoading={busy} onClick={() => status.mutate('done')} />
                <Button label="Вернуть в ожидание" icon={<ArrowCounterClockwise size={18} />} variant="ghost" isLoading={busy} onClick={() => status.mutate('confirmed')} />
              </HStack>
            )}
            {b.status === 'done' && <Button label="Отменить «Готово»" icon={<ArrowCounterClockwise size={18} />} variant="ghost" isLoading={busy} onClick={() => status.mutate('arrived')} />}
            {b.status === 'no_show' && <Button label="Вернуть в ожидание" icon={<ArrowCounterClockwise size={18} />} variant="ghost" isLoading={busy} onClick={() => status.mutate('confirmed')} />}

            {b.status !== 'cancelled' && (
              <HStack gap={2} wrap="wrap">
                <Button
                  label="Внести оплату"
                  icon={<Check size={18} />}
                  onClick={() => {
                    setMode('payment');
                    setAmount(due ? String(due) : '');
                  }}
                />
                {paidNet > 0 && <Button label="Возврат" variant="ghost" onClick={() => setMode('refund')} />}
                {b.status === 'confirmed' && <Button label="Перенести" onClick={() => setMode('reschedule')} />}
              </HStack>
            )}
            {['confirmed', 'no_show'].includes(b.status) && (
              <Button label="Отменить запись" icon={<CalendarX size={18} />} variant="destructive" onClick={() => setCancelOpen(true)} />
            )}
          </VStack>
        )}

        {(mode === 'payment' || mode === 'refund') && (
          <VStack gap={3}>
            <Heading level={3}>{mode === 'refund' ? 'Возврат' : 'Оплата'}</Heading>
            <NumberField label={`Сумма, ${currencySign(tenant.currency)}`} value={amount} onChange={setAmount} decimal size="lg" description={mode === 'refund' ? `Не больше ${money(paidNet, tenant.currency)}` : undefined} />
            <SegmentedControl label="Способ" value={method} onChange={setMethod} layout="fill">
              {METHODS.map((m) => (
                <SegmentedControlItem key={m.value} value={m.value} label={m.label} />
              ))}
            </SegmentedControl>
            <TextInput label="Заметка" isOptional value={note} onChange={setNote} />
            {pay.isError && <Banner status="error" title="Не сохранено" description={errorText(pay.error)} collapsible={false} />}
            <HStack gap={2}>
              <Button label="Сохранить" variant="primary" isLoading={pay.isPending} onClick={() => pay.mutate()} />
              <Button label="Назад" variant="ghost" onClick={() => setMode('view')} />
            </HStack>
          </VStack>
        )}

        {mode === 'reschedule' && <RescheduleForm booking={b} onDone={() => setMode('view')} />}

        <Divider />
        <VStack gap={2}>
          <Text type="label">История оплат</Text>
          {payments.isPending ? (
            <Text type="supporting">Загрузка…</Text>
          ) : payments.isError ? (
            <Text type="supporting">{errorText(payments.error)}</Text>
          ) : payments.data.length === 0 ? (
            <Text type="supporting">Оплат пока нет</Text>
          ) : (
            payments.data.map((p) => (
              <HStack key={p.id} hAlign="between">
                <Text>
                  {p.kind === 'refund' ? 'Возврат' : 'Оплата'} · {METHODS.find((m) => m.value === p.method)?.label ?? p.method}
                  {p.note ? ` · ${p.note}` : ''}
                </Text>
                <Text className="tabular" weight="semibold">
                  {p.kind === 'refund' ? '−' : '+'}
                  {money(Number(p.amount), tenant.currency)}
                </Text>
              </HStack>
            ))
          )}
        </VStack>
      </VStack>
      <AlertDialog
        isOpen={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Отменить запись?"
        description={`${b.client_name}, ${fmt(b.starts_at, tz, 'd MMMM HH:mm')}. Время мастера освободится.${cancel.isError ? ` Ошибка: ${errorText(cancel.error)}` : ''}`}
        actionLabel="Отменить запись"
        cancelLabel="Не отменять"
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate()}
      />
    </BottomSheet>
  );
}
