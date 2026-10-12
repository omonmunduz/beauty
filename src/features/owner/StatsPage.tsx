import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { api } from '@/lib/api';
import { fmtDate, money, plural, resolvePeriod, type PeriodKey } from '@/lib/format';
import { ErrorBlock, LoadingBlock } from '@/components/ui';
import { ownerKey, useOwner } from './OwnerRoot';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'День' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'last_month', label: 'Прошлый' },
];

// Periods come from the same resolvePeriod() the AI assistant uses, in the studio timezone.
export function StatsPage() {
  const { tenant } = useOwner();
  const [period, setPeriod] = useState<PeriodKey>('week');
  const range = resolvePeriod(period, tenant.timezone);
  const q = useQuery({
    queryKey: ownerKey(tenant.id, 'stats', range.from, range.to),
    queryFn: () => api.ownerStats(tenant.id, range.from, range.to),
  });
  const cur = tenant.currency;
  const max = Math.max(1, ...(q.data?.by_day ?? []).map((d) => Number(d.received)));

  return (
    <>
      <header className="owner-top">
        <VStack gap={3}>
          <VStack gap={0}>
            <span className="eyebrow">{tenant.name}</span>
            <h1 style={{ margin: 0, fontSize: 24 }}>Статистика</h1>
          </VStack>
          <SegmentedControl label="Период" value={period} onChange={(v) => setPeriod(v as PeriodKey)} layout="fill" size="sm">
            {PERIODS.map((p) => (
              <SegmentedControlItem key={p.key} value={p.key} label={p.label} />
            ))}
          </SegmentedControl>
        </VStack>
      </header>
      <div className="section" style={{ paddingTop: 16 }}>
        <VStack gap={4}>
          <Text color="secondary">
            {range.label[0]!.toUpperCase() + range.label.slice(1)}: {fmtDate(range.from, 'd MMM')}
            {range.from !== range.to ? ` – ${fmtDate(range.to, 'd MMM')}` : ''} · часовой пояс {tenant.timezone}
          </Text>
          {q.isPending ? (
            <LoadingBlock rows={4} />
          ) : q.isError ? (
            <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <>
              <div className="kpis">
                <div className="kpi kpi--wide">
                  <div className="kpi__label">Получено (оплаты − возвраты)</div>
                  <div className="kpi__value">{money(Number(q.data.received), cur)}</div>
                  <Text type="supporting">
                    Оплаты {money(Number(q.data.payments_total), cur)} · возвраты {money(Number(q.data.refunds_total), cur)}
                  </Text>
                </div>
                <div className="kpi">
                  <div className="kpi__value">{q.data.visits}</div>
                  <div className="kpi__label">{plural(q.data.visits, 'визит', 'визита', 'визитов')} (пришли)</div>
                </div>
                <div className="kpi">
                  <div className="kpi__value">{q.data.completed}</div>
                  <div className="kpi__label">выполнено</div>
                </div>
                <div className="kpi">
                  <div className="kpi__value">{q.data.booked}</div>
                  <div className="kpi__label">всего записей</div>
                </div>
                <div className="kpi">
                  <div className="kpi__value">
                    {q.data.cancelled} / {q.data.no_show}
                  </div>
                  <div className="kpi__label">отмены / неявки</div>
                </div>
                <div className="kpi kpi--wide">
                  <div className="kpi__label">Ожидается по будущим записям периода</div>
                  <div className="kpi__value" style={{ fontSize: 20 }}>
                    {money(Number(q.data.expected), cur)}
                  </div>
                  <Text type="supporting">Это стоимость ещё не оказанных услуг, а не выручка.</Text>
                </div>
              </div>
              {q.data.by_day.length > 1 && (
                <VStack gap={2}>
                  <Text type="label">Получено по дням</Text>
                  <div className="bars" role="img" aria-label="Диаграмма полученных денег по дням">
                    {q.data.by_day.map((d) => (
                      <div
                        key={d.date}
                        className="bar"
                        data-zero={Number(d.received) === 0}
                        style={{ height: `${Math.max(2, (Number(d.received) / max) * 100)}%` }}
                        title={`${fmtDate(d.date, 'd MMM')}: ${money(Number(d.received), cur)}, визитов ${d.visits}`}
                      />
                    ))}
                  </div>
                  {q.data.by_day.length <= 10 && (
                    <div className="bar-labels" aria-hidden>
                      {q.data.by_day.map((d) => (
                        <span key={d.date}>{fmtDate(d.date, 'EEEEEE')}</span>
                      ))}
                    </div>
                  )}
                </VStack>
              )}
              {q.data.top_services.length > 0 && (
                <VStack gap={2}>
                  <Text type="label">Популярные услуги (по визитам)</Text>
                  {q.data.top_services.map((s) => (
                    <div key={s.name} className="summary__row" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text>{s.name}</Text>
                      <Text className="tabular" weight="semibold">
                        {s.count}
                      </Text>
                    </div>
                  ))}
                </VStack>
              )}
            </>
          )}
        </VStack>
      </div>
    </>
  );
}
