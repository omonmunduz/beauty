import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Banner } from '@astryxdesign/core/Banner';
import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Heading } from '@astryxdesign/core/Heading';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { useToast } from '@astryxdesign/core/Toast';
import { Plus } from '@phosphor-icons/react';
import { errorText, toAppError } from '@/lib/errors';
import { currencySign, duration, priceLabel } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { fieldErrors } from '@/lib/validation';
import { NumberField } from '@/components/fields';
import { ErrorBlock, LoadingBlock } from '@/components/ui';
import { useOwner } from '../OwnerRoot';
import { useCatalog, type OwnerService } from '../catalog';
import { useRefreshStudio } from './SettingsSection';

const schema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(120),
  category: z.string().trim().min(1, 'Укажите категорию').max(40),
  description: z.string().max(400),
  duration_min: z.coerce.number().int().min(5, 'От 5 минут').max(4320),
  buffer_min: z.coerce.number().int().min(0).max(240),
  price: z.coerce.number().min(0, 'Цена не может быть отрицательной'),
  price_is_from: z.boolean(),
  popular: z.boolean(),
  active: z.boolean(),
  masters: z.array(z.string()).min(1, 'Выберите хотя бы одного мастера'),
});

function ServiceEditor({ service, onClose }: { service: OwnerService | null; onClose: () => void }) {
  const { tenant } = useOwner();
  const catalog = useCatalog(tenant.id);
  const refresh = useRefreshStudio();
  const toast = useToast();
  const [f, setF] = useState(() => ({
    name: service?.name ?? '',
    category: service?.category ?? '',
    description: service?.description ?? '',
    duration_min: String(service?.duration_min ?? 60),
    buffer_min: String(service?.buffer_min ?? 15),
    price: String(service?.price ?? ''),
    price_is_from: service?.price_is_from ?? false,
    popular: service?.popular ?? false,
    active: service?.active ?? true,
    masters: service ? (catalog.data?.mastersOf(service.id) ?? []) : (catalog.data?.resources.filter((r) => r.active).map((r) => r.id) ?? []),
  }));
  const [touched, setTouched] = useState(false);
  const errors = touched ? fieldErrors(schema, f) : {};
  const err = (k: string) => (errors[k] ? { type: 'error' as const, message: errors[k] } : undefined);

  const save = useMutation({
    mutationFn: async () => {
      const { masters, ...row } = schema.parse(f);
      let id = service?.id;
      if (id) {
        const { error } = await supabase.from('services').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id);
        if (error) throw toAppError(error);
      } else {
        const { data, error } = await supabase.from('services').insert({ ...row, tenant_id: tenant.id, sort: 1000 }).select('id').single();
        if (error) throw toAppError(error);
        id = data.id as string;
      }
      const del = await supabase.from('resource_services').delete().eq('service_id', id);
      if (del.error) throw toAppError(del.error);
      const ins = await supabase.from('resource_services').insert(masters.map((m) => ({ tenant_id: tenant.id, resource_id: m, service_id: id })));
      if (ins.error) throw toAppError(ins.error);
    },
    onSuccess: async () => {
      await refresh();
      toast({ body: service ? 'Услуга обновлена. Цены в уже созданных записях не меняются.' : 'Услуга добавлена' });
      onClose();
    },
  });

  return (
    <BottomSheet isOpen onOpenChange={(o) => !o && onClose()} label={service ? 'Изменить услугу' : 'Новая услуга'} height="tall" padding={4} purpose="form">
      <VStack gap={3}>
        <Heading level={2}>{service ? 'Изменить услугу' : 'Новая услуга'}</Heading>
        <TextInput label="Название" value={f.name} onChange={(v) => setF({ ...f, name: v })} status={err('name')} />
        <TextInput label="Категория" value={f.category} onChange={(v) => setF({ ...f, category: v })} status={err('category')} description="Например: Шугаринг, Воск, Лазер, Комплексы" />
        <TextArea label="Описание" isOptional value={f.description} onChange={(v) => setF({ ...f, description: v })} rows={2} maxLength={400} />
        <HStack gap={2}>
          <NumberField label={`Цена, ${currencySign(tenant.currency)}`} value={f.price} onChange={(v) => setF({ ...f, price: v })} status={err('price')} decimal />
          <NumberField label="Длительность, мин" value={f.duration_min} onChange={(v) => setF({ ...f, duration_min: v })} status={err('duration_min')} />
        </HStack>
        <NumberField label="Подготовка кабинета после, мин" value={f.buffer_min} onChange={(v) => setF({ ...f, buffer_min: v })} description="Время между клиентами: мастер в это время занят" />
        <Switch label="Цена «от»" value={f.price_is_from} onChange={(v) => setF({ ...f, price_is_from: v })} />
        <Switch label="Популярная (показывать первой)" value={f.popular} onChange={(v) => setF({ ...f, popular: v })} />
        <Switch label="Доступна для записи" value={f.active} onChange={(v) => setF({ ...f, active: v })} />
        <VStack gap={1}>
          <Text type="label">Кто выполняет</Text>
          {(catalog.data?.resources ?? []).map((r) => (
            <CheckboxInput
              key={r.id}
              label={`${r.name}${r.active ? '' : ' (неактивен)'}`}
              value={f.masters.includes(r.id)}
              onChange={(checked: boolean) => setF({ ...f, masters: checked ? [...f.masters, r.id] : f.masters.filter((m) => m !== r.id) })}
            />
          ))}
          {errors.masters && <Text color="accent">{errors.masters}</Text>}
        </VStack>
        {save.isError && <Banner status="error" title="Не сохранено" description={errorText(save.error)} collapsible={false} />}
        <div className="sheet-footer">
          <Button
            label="Сохранить"
            variant="primary"
            size="lg"
            width="100%"
            isLoading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (schema.safeParse(f).success) save.mutate();
            }}
          />
        </div>
      </VStack>
    </BottomSheet>
  );
}

export function ServicesSection() {
  const { tenant } = useOwner();
  const catalog = useCatalog(tenant.id);
  const [editing, setEditing] = useState<OwnerService | 'new' | null>(null);
  if (catalog.isPending) return <LoadingBlock />;
  if (catalog.isError) return <ErrorBlock error={catalog.error} onRetry={() => catalog.refetch()} />;
  const names = new Map(catalog.data.resources.map((r) => [r.id, r.name.split(' ')[0]]));
  return (
    <VStack gap={4}>
      <Button label="Добавить услугу" icon={<Plus size={18} />} variant="primary" onClick={() => setEditing('new')} />
      <ul className="service-list">
        {catalog.data.services.map((s) => (
          <li key={s.id}>
            <button type="button" className="service-row tap" onClick={() => setEditing(s)} style={{ opacity: s.active ? 1 : 0.5 }}>
              <span className="service-row__name">{s.name}</span>
              <span className="service-row__price">{priceLabel(s.price, tenant.currency, s.price_is_from)}</span>
              <span className="service-row__meta">
                <span>{s.category}</span>
                <span>· {duration(s.duration_min)}{s.buffer_min ? ` + ${s.buffer_min} мин` : ''}</span>
                <span>· {catalog.data.mastersOf(s.id).map((id) => names.get(id)).join(', ') || 'нет мастера!'}</span>
                {!s.active && <span>· скрыта</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editing && <ServiceEditor service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </VStack>
  );
}
