import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useToast } from '@astryxdesign/core/Toast';
import { Trash } from '@phosphor-icons/react';
import { errorText, toAppError } from '@/lib/errors';
import { fmtDate, localDate, WEEKDAY_SHORT } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { ErrorBlock, LoadingBlock } from '@/components/ui';
import { ownerKey, useOwner } from '../OwnerRoot';
import { useRefreshStudio } from './SettingsSection';

interface Day {
  weekday: number;
  open: boolean;
  opens: string;
  closes: string;
}
interface Exception {
  day: string;
  opens: string | null;
  closes: string | null;
  note: string;
}

export function HoursSection() {
  const { tenant } = useOwner();
  const refresh = useRefreshStudio();
  const toast = useToast();
  const q = useQuery({
    queryKey: ownerKey(tenant.id, 'hours'),
    queryFn: async () => {
      const [h, e] = await Promise.all([
        supabase.from('working_hours').select('weekday, opens, closes').eq('tenant_id', tenant.id),
        supabase.from('schedule_exceptions').select('day, opens, closes, note').eq('tenant_id', tenant.id).gte('day', localDate(new Date(), tenant.timezone)).order('day'),
      ]);
      if (h.error) throw toAppError(h.error);
      if (e.error) throw toAppError(e.error);
      return { hours: h.data as { weekday: number; opens: string; closes: string }[], exceptions: e.data as Exception[] };
    },
  });
  const [days, setDays] = useState<Day[]>([]);
  const [newEx, setNewEx] = useState({ day: '', closed: true, opens: '10:00', closes: '16:00', note: '' });

  useEffect(() => {
    if (!q.data) return;
    setDays(
      [1, 2, 3, 4, 5, 6, 7].map((wd) => {
        const h = q.data.hours.find((x) => x.weekday === wd);
        return { weekday: wd, open: !!h, opens: h?.opens.slice(0, 5) ?? '10:00', closes: h?.closes.slice(0, 5) ?? '20:00' };
      }),
    );
  }, [q.data]);

  const saveWeek = useMutation({
    mutationFn: async () => {
      const bad = days.find((d) => d.open && d.closes <= d.opens);
      if (bad) throw new Error(`${WEEKDAY_SHORT[bad.weekday - 1]}: закрытие должно быть позже открытия`);
      const del = await supabase.from('working_hours').delete().eq('tenant_id', tenant.id);
      if (del.error) throw toAppError(del.error);
      const rows = days.filter((d) => d.open).map((d) => ({ tenant_id: tenant.id, weekday: d.weekday, opens: d.opens, closes: d.closes }));
      if (rows.length) {
        const ins = await supabase.from('working_hours').insert(rows);
        if (ins.error) throw toAppError(ins.error);
      }
    },
    onSuccess: async () => {
      await refresh();
      toast({ body: 'График сохранён — свободные окна пересчитаны' });
    },
  });

  const addEx = useMutation({
    mutationFn: async () => {
      if (!newEx.day) throw new Error('Выберите дату');
      if (!newEx.closed && newEx.closes <= newEx.opens) throw new Error('Закрытие должно быть позже открытия');
      const { error } = await supabase.from('schedule_exceptions').upsert({
        tenant_id: tenant.id, day: newEx.day, opens: newEx.closed ? null : newEx.opens, closes: newEx.closed ? null : newEx.closes, note: newEx.note,
      });
      if (error) throw toAppError(error);
    },
    onSuccess: async () => {
      setNewEx({ day: '', closed: true, opens: '10:00', closes: '16:00', note: '' });
      await refresh();
      toast({ body: 'Особый день добавлен' });
    },
  });
  const delEx = useMutation({
    mutationFn: async (day: string) => {
      const { error } = await supabase.from('schedule_exceptions').delete().eq('tenant_id', tenant.id).eq('day', day);
      if (error) throw toAppError(error);
    },
    onSuccess: () => refresh(),
  });

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;

  return (
    <VStack gap={6}>
      <VStack gap={3}>
        <Heading level={3}>Неделя</Heading>
        <Text type="supporting">Часы определяют, когда можно начать процедуру. Часовой пояс студии: {tenant.timezone}.</Text>
        {days.map((d, i) => (
          <div key={d.weekday} className="hours-row">
            <strong>{WEEKDAY_SHORT[i]}</strong>
            <Switch label={`${WEEKDAY_SHORT[i]} рабочий`} isLabelHidden value={d.open} onChange={(v) => setDays(days.map((x, j) => (j === i ? { ...x, open: v } : x)))} />
            {d.open ? (
              <>
                <input className="time-input" type="time" aria-label={`${WEEKDAY_SHORT[i]}: открытие`} value={d.opens} onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, opens: e.target.value } : x)))} />
                <input className="time-input" type="time" aria-label={`${WEEKDAY_SHORT[i]}: закрытие`} value={d.closes} onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, closes: e.target.value } : x)))} />
              </>
            ) : (
              <span className="muted" style={{ gridColumn: 'span 2' }}>
                выходной
              </span>
            )}
          </div>
        ))}
        {saveWeek.isError && <Banner status="error" title="Не сохранено" description={errorText(saveWeek.error) === 'Что-то пошло не так. Попробуйте ещё раз.' ? (saveWeek.error as Error).message : errorText(saveWeek.error)} collapsible={false} />}
        <Button label="Сохранить график" variant="primary" isLoading={saveWeek.isPending} onClick={() => saveWeek.mutate()} />
      </VStack>

      <VStack gap={3}>
        <Heading level={3}>Особые дни</Heading>
        {q.data.exceptions.length === 0 && <Text type="supporting">Праздники и сокращённые дни появятся здесь.</Text>}
        {q.data.exceptions.map((e) => (
          <HStack key={e.day} hAlign="between" vAlign="center">
            <Text>
              {fmtDate(e.day, 'd MMMM, EEEEEE')} — {e.opens ? `${e.opens.slice(0, 5)}–${e.closes?.slice(0, 5)}` : 'закрыто'}
              {e.note ? ` · ${e.note}` : ''}
            </Text>
            <IconButton label="Удалить особый день" icon={<Trash size={16} />} variant="ghost" size="sm" onClick={() => delEx.mutate(e.day)} />
          </HStack>
        ))}
        <VStack gap={2}>
          <HStack gap={2} wrap="wrap" vAlign="center">
            <input className="time-input" type="date" aria-label="Дата" value={newEx.day} min={localDate(new Date(), tenant.timezone)} onChange={(e) => setNewEx({ ...newEx, day: e.target.value })} />
            <Switch label="Закрыто весь день" value={newEx.closed} onChange={(v) => setNewEx({ ...newEx, closed: v })} />
          </HStack>
          {!newEx.closed && (
            <HStack gap={2}>
              <input className="time-input" type="time" aria-label="Открытие" value={newEx.opens} onChange={(e) => setNewEx({ ...newEx, opens: e.target.value })} />
              <input className="time-input" type="time" aria-label="Закрытие" value={newEx.closes} onChange={(e) => setNewEx({ ...newEx, closes: e.target.value })} />
            </HStack>
          )}
          <TextInput label="Комментарий" isOptional value={newEx.note} onChange={(v) => setNewEx({ ...newEx, note: v })} placeholder="Например, праздник" />
          {addEx.isError && <Banner status="error" title="Не добавлено" description={(addEx.error as Error).message} collapsible={false} />}
          <Button label="Добавить особый день" isLoading={addEx.isPending} onClick={() => addEx.mutate()} />
        </VStack>
      </VStack>
    </VStack>
  );
}
