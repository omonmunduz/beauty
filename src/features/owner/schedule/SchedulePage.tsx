import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@astryxdesign/core/Toast';
import { errorText } from '@/lib/errors';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CaretLeft, CaretRight, Lock, Plus, SignOut } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { addDays, fmt, fmtDate, humanDate, isoWeekday, localDate, money, plural } from '@/lib/format';
import type { OwnerBooking } from '@/lib/types';
import { ErrorBlock, LoadingBlock } from '@/components/ui';
import { ownerKey, useOwner } from '../OwnerRoot';
import { BookingSheet } from './BookingSheet';
import { NewBookingSheet } from './NewBookingSheet';
import { BlockSheet } from './BlockSheet';

type View = 'day' | 'week';

export function SchedulePage() {
  const { tenant, signOut } = useOwner();
  const tz = tenant.timezone;
  const today = localDate(new Date(), tz);
  const [params] = useSearchParams();
  const initialDate = params.get('date');
  const [view, setView] = useState<View>(params.get('view') === 'week' ? 'week' : 'day');
  const [date, setDate] = useState(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : today);
  const [master, setMaster] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const monday = addDays(date, 1 - isoWeekday(date));
  const from = view === 'day' ? date : monday;
  const to = view === 'day' ? date : addDays(monday, 6);
  const q = useQuery({
    queryKey: ownerKey(tenant.id, 'schedule', from, to),
    queryFn: () => api.ownerSchedule(tenant.id, from, to),
    refetchInterval: 60_000,
  });
  // Week counts for the date strip come from the week query regardless of the view.
  const week = useQuery({
    queryKey: ownerKey(tenant.id, 'schedule', monday, addDays(monday, 6)),
    queryFn: () => api.ownerSchedule(tenant.id, monday, addDays(monday, 6)),
  });

  const masters = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of q.data?.bookings ?? []) m.set(b.resource_id, b.resource_name);
    return [...m.entries()];
  }, [q.data]);

  const bookings = (q.data?.bookings ?? []).filter((b) => master === 'all' || b.resource_id === master);
  const blocks = (q.data?.blocks ?? []).filter((b) => master === 'all' || b.resource_id === master);
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const expected = active.filter((b) => b.status === 'confirmed').reduce((s, b) => s + Number(b.price), 0);
  const received = bookings.reduce((s, b) => s + Number(b.paid) - Number(b.refunded), 0);
  const openBooking: OwnerBooking | undefined = (q.data?.bookings ?? []).find((b) => b.id === openId);
  const days = view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayOf = (iso: string) => localDate(new Date(iso), tz);
  const shift = (n: number) => setDate(addDays(date, view === 'day' ? n : n * 7));

  return (
    <>
      <header className="owner-top">
        <VStack gap={3}>
          <HStack hAlign="between" vAlign="center">
            <VStack gap={0}>
              <span className="eyebrow">{tenant.name}</span>
              <h1 style={{ margin: 0, fontSize: 24 }}>Расписание</h1>
            </VStack>
            <HStack gap={1}>
              <IconButton label="Заблокировать время" icon={<Lock size={18} />} onClick={() => setBlocking(true)} />
              <Button label="Запись" icon={<Plus size={18} weight="bold" />} variant="primary" onClick={() => setCreating(true)} />
              <IconButton label="Выйти" icon={<SignOut size={18} />} variant="ghost" onClick={() => void signOut()} />
            </HStack>
          </HStack>
          <HStack hAlign="between" vAlign="center" gap={2}>
            <SegmentedControl label="Вид" value={view} onChange={(v) => setView(v as View)} size="sm">
              <SegmentedControlItem value="day" label="День" />
              <SegmentedControlItem value="week" label="Неделя" />
            </SegmentedControl>
            <HStack gap={1} vAlign="center">
              <IconButton label="Назад" icon={<CaretLeft size={16} />} size="sm" variant="ghost" onClick={() => shift(-1)} />
              <Button label={date === today && view === 'day' ? 'Сегодня' : view === 'day' ? fmtDate(date, 'd MMM, EEEEEE') : `${fmtDate(monday, 'd MMM')} – ${fmtDate(addDays(monday, 6), 'd MMM')}`} size="sm" variant="ghost" onClick={() => setDate(today)} />
              <IconButton label="Вперёд" icon={<CaretRight size={16} />} size="sm" variant="ghost" onClick={() => shift(1)} />
            </HStack>
          </HStack>
          <div className="date-strip" role="group" aria-label="Дни недели" style={{ gridAutoFlow: 'initial', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, overflow: 'visible' }}>
            {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => {
              const n = (week.data?.bookings ?? []).filter((b) => b.status !== 'cancelled' && dayOf(b.starts_at) === d).length;
              return (
                <button
                  key={d}
                  type="button"
                  className="date-btn tap"
                  style={{ height: 62, ['--has-free' as string]: n ? 1 : 0 }}
                  aria-pressed={view === 'day' && d === date}
                  onClick={() => {
                    setDate(d);
                    setView('day');
                  }}
                  aria-label={`${fmtDate(d, 'EEEE d MMMM')}: ${n} ${plural(n, 'запись', 'записи', 'записей')}`}
                >
                  <small>{fmtDate(d, 'EEEEEE')}</small>
                  <strong>{fmtDate(d, 'd')}</strong>
                  <small className="tabular">{n || '·'}</small>
                </button>
              );
            })}
          </div>
        </VStack>
      </header>

      <div className="section" style={{ paddingTop: 16 }}>
        <VStack gap={4}>
          {masters.length > 1 && (
            <div className="chips" role="group" aria-label="Мастер">
              <button type="button" className="chip" aria-pressed={master === 'all'} onClick={() => setMaster('all')}>
                Все мастера
              </button>
              {masters.map(([id, name]) => (
                <button key={id} type="button" className="chip" aria-pressed={master === id} onClick={() => setMaster(id)}>
                  {name.split(' ')[0]}
                </button>
              ))}
            </div>
          )}
          {q.isPending ? (
            <LoadingBlock rows={5} />
          ) : q.isError ? (
            <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <>
              <div className="kpis">
                <div className="kpi">
                  <div className="kpi__value">{active.length}</div>
                  <div className="kpi__label">{plural(active.length, 'запись', 'записи', 'записей')}</div>
                </div>
                <div className="kpi">
                  <div className="kpi__value">{money(received, tenant.currency)}</div>
                  <div className="kpi__label">получено по этим визитам</div>
                </div>
                {expected > 0 && (
                  <div className="kpi kpi--wide">
                    <div className="kpi__label">Ожидается по подтверждённым записям (ещё не выручка): {money(expected, tenant.currency)}</div>
                  </div>
                )}
              </div>
              {days.map((d) => {
                const list = bookings.filter((b) => dayOf(b.starts_at) === d);
                const dayBlocks = blocks.filter((b) => dayOf(b.starts_at) <= d && dayOf(b.ends_at) >= d);
                return (
                  <VStack gap={2} key={d}>
                    {view === 'week' && (
                      <Text type="label">
                        {humanDate(d, tz)[0]!.toUpperCase() + humanDate(d, tz).slice(1)} · {fmtDate(d, 'd MMMM')}
                      </Text>
                    )}
                    {list.length === 0 && dayBlocks.length === 0 ? (
                      view === 'day' ? (
                        <EmptyState isCompact title="Записей нет" description="Свободный день — можно добавить запись вручную." actions={<Button label="Добавить запись" onClick={() => setCreating(true)} />} />
                      ) : (
                        <Text type="supporting">Записей нет</Text>
                      )
                    ) : (
                      <div className="timeline">
                        {dayBlocks.map((b) => (
                          <div key={b.id} className="block-row">
                            <span className="tabular">{fmt(b.starts_at, tz, 'HH:mm')}</span>
                            <span>
                              <Lock size={14} aria-hidden /> {b.resource_name}: {b.note || 'заблокировано'} до {fmt(b.ends_at, tz, dayOf(b.ends_at) === d ? 'HH:mm' : 'd MMM HH:mm')}
                            </span>
                            <UnblockButton tenantId={tenant.id} id={b.id} />
                          </div>
                        ))}
                        {list.map((b) => (
                          <button key={b.id} type="button" className="appt tap" data-status={b.status} onClick={() => setOpenId(b.id)}>
                            <span>
                              <span className="appt__time" style={{ display: 'block' }}>
                                {fmt(b.starts_at, tz, 'HH:mm')}
                              </span>
                              <span className="appt__end">{fmt(b.ends_at, tz, 'HH:mm')}</span>
                            </span>
                            <span>
                              <span className="appt__title" style={{ display: 'block' }}>
                                {b.client_name}
                              </span>
                              <span className="appt__sub" style={{ display: 'block' }}>
                                {b.service_name} · {b.resource_name.split(' ')[0]}
                                {b.is_demo ? ' · демо' : ''}
                              </span>
                            </span>
                            <span className="tabular" style={{ fontWeight: 700, fontSize: 14 }}>
                              {money(Number(b.price), tenant.currency)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </VStack>
                );
              })}
            </>
          )}
        </VStack>
      </div>

      {openBooking && <BookingSheet booking={openBooking} onClose={() => setOpenId(null)} />}
      {creating && <NewBookingSheet defaultDate={date} onClose={() => setCreating(false)} />}
      {blocking && <BlockSheet defaultDate={date} onClose={() => setBlocking(false)} />}
    </>
  );
}


function UnblockButton({ tenantId, id }: { tenantId: string; id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.ownerUnblock(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['owner', tenantId] });
      toast({ body: 'Время разблокировано' });
    },
    onError: (e) => toast({ body: errorText(e), type: 'error' }),
  });
  return <Button label="Снять" size="sm" variant="ghost" isLoading={m.isPending} onClick={() => m.mutate()} />;
}
