import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { errorText, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { InfoCard } from '@/lib/types';
import { fieldErrors } from '@/lib/validation';
import { NumberField, PhoneInput } from '@/components/fields';
import { INFO_ICON_NAMES, InfoIcon } from '@/components/ui';
import { useOwner } from '../OwnerRoot';
import { useRefreshStudio } from './SettingsSection';

const schema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(80),
  tagline: z.string().max(140, 'До 140 символов'),
  about: z.string().max(1200),
  phone: z.string().refine((v) => v.replace(/\D/g, '').length >= 10, 'Проверьте телефон'),
  whatsapp: z.string().max(20),
  telegram: z.string().max(40),
  instagram: z.string().max(40),
  address: z.string().trim().min(3, 'Укажите адрес'),
  address_note: z.string().max(200),
  map_url: z.union([z.literal(''), z.url('Ссылка вида https://…')]),
  cancel_hours: z.coerce.number().int().min(0).max(168),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Цвет вида #E8A598'),
  info_cards: z.array(z.object({ icon: z.string(), title: z.string().trim().min(1, 'Заголовок карточки').max(40), text: z.string().max(160) })).length(3),
});

export function ProfileSection() {
  const { tenant } = useOwner();
  const refresh = useRefreshStudio();
  const toast = useToast();
  const [f, setF] = useState({
    name: tenant.name, tagline: tenant.tagline, about: tenant.about, phone: tenant.phone, whatsapp: tenant.whatsapp,
    telegram: tenant.telegram, instagram: tenant.instagram, address: tenant.address, address_note: tenant.address_note,
    map_url: tenant.map_url, cancel_hours: String(tenant.cancel_hours), accent: tenant.accent,
    info_cards: [0, 1, 2].map((i) => tenant.info_cards[i] ?? { icon: 'sparkle', title: '', text: '' }) as InfoCard[],
  });
  const [touched, setTouched] = useState(false);
  const errors = touched ? fieldErrors(schema, f) : {};
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const setCard = (i: number, patch: Partial<InfoCard>) => setF((x) => ({ ...x, info_cards: x.info_cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const save = useMutation({
    mutationFn: async () => {
      const data = schema.parse(f);
      const { error } = await supabase.from('tenants').update(data).eq('id', tenant.id);
      if (error) throw toAppError(error);
    },
    onSuccess: async () => {
      await refresh();
      toast({ body: 'Сохранено — изменения уже на странице студии' });
    },
  });
  const err = (k: string) => (errors[k] ? { type: 'error' as const, message: errors[k] } : undefined);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!schema.safeParse(f).success) return;
        save.mutate();
      }}
    >
      <VStack gap={4}>
        <TextInput label="Название" value={f.name} onChange={set('name')} status={err('name')} />
        <TextInput label="Слоган" value={f.tagline} onChange={set('tagline')} status={err('tagline')} description="Строка под названием на главном фото" />
        <TextArea label="О студии" value={f.about} onChange={set('about')} rows={4} maxLength={1200} />
        <PhoneInput label="Телефон" value={f.phone} onChange={set('phone')} status={err('phone')} />
        <TextInput label="WhatsApp (номер)" isOptional value={f.whatsapp} onChange={set('whatsapp')} />
        <TextInput label="Telegram (ник без @)" isOptional value={f.telegram} onChange={set('telegram')} />
        <TextInput label="Instagram" isOptional value={f.instagram} onChange={set('instagram')} />
        <TextInput label="Адрес" value={f.address} onChange={set('address')} status={err('address')} />
        <TextInput label="Как найти вход" isOptional value={f.address_note} onChange={set('address_note')} />
        <TextInput label="Ссылка на карту" isOptional value={f.map_url} onChange={set('map_url')} status={err('map_url')} placeholder="https://yandex.ru/maps/…" />
        <NumberField label="Отмена онлайн не позднее чем за, ч" value={f.cancel_hours} onChange={set('cancel_hours')} />
        <TextInput label="Акцентный цвет" value={f.accent} onChange={set('accent')} status={err('accent')} description="Один цвет для кнопок и выделений, формат #RRGGBB" />

        <Heading level={3}>Карточки на главной</Heading>
        {f.info_cards.map((c, i) => (
          <VStack key={i} gap={2}>
            <Selector
              label={`Карточка ${i + 1}: значок`}
              value={c.icon}
              onChange={(v) => setCard(i, { icon: v })}
              options={INFO_ICON_NAMES.map((n) => ({ value: n, label: n }))}
              renderOption={(o) => (
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <InfoIcon name={String(o.value)} size={18} /> {String(o.label)}
                </span>
              )}
            />
            <TextInput label="Заголовок" value={c.title} onChange={(v) => setCard(i, { title: v })} status={err('info_cards')} />
            <TextArea label="Текст" value={c.text} onChange={(v) => setCard(i, { text: v })} rows={2} maxLength={160} />
          </VStack>
        ))}
        {save.isError && <Banner status="error" title="Не сохранено" description={errorText(save.error)} collapsible={false} />}
        <div className="sheet-footer sheet-footer--page">
          <Button label="Сохранить" type="submit" variant="primary" size="lg" width="100%" isLoading={save.isPending} />
        </div>
      </VStack>
    </form>
  );
}
