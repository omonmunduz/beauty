import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BottomSheet, BottomSheetSwitcher } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { useToast } from '@astryxdesign/core/Toast';
import { Star, UsersThree } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { AppError, errorText } from '@/lib/errors';
import { duration, fmt, humanDate, localDate, priceLabel } from '@/lib/format';
import { loadDraft, saveBooking, saveDraft } from '@/lib/storage';
import { contactSchema, fieldErrors } from '@/lib/validation';
import { PhoneInput, phoneExample } from '@/components/fields';
import { useIdempotencyKey } from '@/components/ui';
import { HomePage } from '@/features/studio/HomePage';
import { useSlug, useStudio } from '@/features/studio/StudioRoot';
import { BOOKINGS_CHANGED } from '@/features/studio/StudioLayout';
import { SlotPicker } from './SlotPicker';

type Step = 'service' | 'time' | 'contacts';

export function BookingPage() {
  const slug = useSlug();
  const { tenant, services, resources } = useStudio();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const serviceId = params.get('service');
  const masterId = params.get('master');
  const start = params.get('start');
  const service = services.find((s) => s.id === serviceId) ?? null;
  const master = resources.find((r) => r.id === masterId) ?? null;
  const step: Step = (params.get('step') as Step | null) ?? (service ? (start ? 'contacts' : 'time') : 'service');
  const active: Step = !service ? 'service' : step === 'contacts' && !start ? 'time' : step;

  const go = useCallback(
    (next: Step, patch: Record<string, string | null> = {}) => {
      const p = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      p.set('step', next);
      setParams(p); // push: the system Back button walks back through the steps
    },
    [params, setParams],
  );
  const close = () => navigate(`/s/${slug}`, { replace: true });

  // ------------------------------------------------------------ step 1
  const [category, setCategory] = useState('all');
  const qualifying = master ? services.filter((s) => s.resource_ids.includes(master.id)) : services;
  const categories = [...new Set(qualifying.map((s) => s.category || 'Услуги'))];
  const shown = qualifying.filter((s) => category === 'all' || (s.category || 'Услуги') === category);

  // ------------------------------------------------------------ step 2
  const serviceMasters = useMemo(() => (service ? resources.filter((r) => service.resource_ids.includes(r.id)) : []), [service, resources]);
  const effectiveMaster = master && serviceMasters.some((m) => m.id === master.id) ? master : null;
  const onSlot = useCallback(
    (s: string | null) => {
      const p = new URLSearchParams(params);
      if (s) p.set('start', s);
      else p.delete('start');
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  // ------------------------------------------------------------ step 3
  const [contact, setContact] = useState(() => ({ ...loadDraft(slug), notes: '' }));
  const [touched, setTouched] = useState(false);
  const errors = touched ? fieldErrors(contactSchema, contact) : {};
  const idemKey = useIdempotencyKey([serviceId, effectiveMaster?.id ?? null, start, contact.phone.replace(/\D/g, '')]);
  const submitRef = useRef<HTMLButtonElement>(null);

  const book = useMutation({
    mutationFn: async () => {
      const parsed = contactSchema.safeParse(contact);
      if (!parsed.success) throw new AppError('validation', 'Проверьте имя и телефон');
      return api.createBooking({
        slug,
        serviceId: service!.id,
        resourceId: effectiveMaster?.id ?? null,
        startsAt: start!,
        name: parsed.data.name,
        phone: parsed.data.phone,
        notes: parsed.data.notes,
        idempotencyKey: idemKey,
      });
    },
    onSuccess: (r) => {
      saveDraft(slug, { name: contact.name.trim(), phone: contact.phone.trim() });
      const stored = r.token ? saveBooking(slug, { id: r.booking_id, token: r.token, startsAt: r.starts_at, serviceName: r.service_name, savedAt: new Date().toISOString() }) : false;
      window.dispatchEvent(new Event(BOOKINGS_CHANGED));
      void qc.invalidateQueries({ queryKey: ['availability', slug] });
      // If this device cannot store the token (private mode), keep it in the URL instead.
      navigate(stored ? `/s/${slug}/me?b=${r.booking_id}&new=1` : `/s/${slug}/b/${r.token}?new=1`, { replace: true });
    },
    onError: (e) => {
      const err = e instanceof AppError ? e : new AppError('unknown');
      if (err.code === 'slot_taken' || err.code === 'slot_invalid') {
        void qc.invalidateQueries({ queryKey: ['availability', slug] });
        toast({ body: err.message, type: 'error' });
        go('time', { start: null });
      }
    },
  });

  const submit = () => {
    setTouched(true);
    if (Object.keys(fieldErrors(contactSchema, contact)).length) return;
    book.mutate();
  };

  const tz = tenant.timezone;
  const startLabel = start ? `${humanDate(localDate(new Date(start), tz), tz)}, ${fmt(start, tz, 'd MMMM, HH:mm')}` : '';

  return (
    <>
      <div aria-hidden="true" inert>
        <HomePage />
      </div>
      <BottomSheetSwitcher activeSheet={active} onActiveSheetChange={(s) => (s ? go(s as Step) : close())}>
        <BottomSheet sheetId="service" label="Выбор услуги" height="tall" padding={4}>
          <VStack gap={4}>
            <VStack gap={1}>
              <span className="eyebrow">Шаг 1 из 3</span>
              <Heading level={2}>{master ? `Услуги мастера ${master.name.split(' ')[0]}` : 'Какая процедура?'}</Heading>
            </VStack>
            {categories.length > 1 && (
              <div className="chips" role="group" aria-label="Категории">
                <button type="button" className="chip" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
                  Все
                </button>
                {categories.map((c) => (
                  <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            <ul className="service-list">
              {shown.map((s) => (
                <li key={s.id}>
                  <button type="button" className="service-row tap" onClick={() => go('time', { service: s.id, start: null })}>
                    <span className="service-row__name">{s.name}</span>
                    <span className="service-row__price">{priceLabel(s.price, tenant.currency, s.price_is_from)}</span>
                    <span className="service-row__meta">
                      {s.popular && (
                        <span className="tag-popular">
                          <Star size={11} weight="fill" aria-hidden /> Популярное
                        </span>
                      )}
                      <span>{duration(s.duration_min)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </VStack>
        </BottomSheet>

        <BottomSheet sheetId="time" label="Выбор времени" height="tall" padding={4}>
          {service && (
            <VStack gap={4}>
              <VStack gap={1}>
                <span className="eyebrow">Шаг 2 из 3</span>
                <Heading level={2}>Дата и время</Heading>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text weight="semibold">{service.name}</Text>
                  <Text color="secondary">
                    · {priceLabel(service.price, tenant.currency, service.price_is_from)} · {duration(service.duration_min)}
                  </Text>
                  <Button label="Изменить" variant="ghost" size="sm" onClick={() => go('service', { start: null })} />
                </HStack>
              </VStack>
              {serviceMasters.length > 1 && (
                <div className="chips" role="group" aria-label="Мастер">
                  <button type="button" className="chip" aria-pressed={!effectiveMaster} onClick={() => go('time', { master: null, start: null })}>
                    <UsersThree size={16} aria-hidden />
                    Любой мастер
                  </button>
                  {serviceMasters.map((m) => (
                    <button key={m.id} type="button" className="chip" aria-pressed={effectiveMaster?.id === m.id} onClick={() => go('time', { master: m.id, start: null })}>
                      {m.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              )}
              <SlotPicker
                slug={slug}
                serviceId={service.id}
                resourceId={effectiveMaster?.id ?? null}
                timezone={tz}
                horizonDays={tenant.horizon_days}
                value={start}
                onChange={onSlot}
              />
              <div className="sheet-footer">
                <Button label={start ? `Далее · ${fmt(start, tz, 'd MMM, HH:mm')}` : 'Выберите время'} variant="primary" size="lg" width="100%" isDisabled={!start} onClick={() => go('contacts')} />
              </div>
            </VStack>
          )}
        </BottomSheet>

        <BottomSheet sheetId="contacts" label="Контакты и подтверждение" height="tall" padding={4} purpose="form">
          {service && start && (
            <VStack gap={4}>
              <VStack gap={1}>
                <span className="eyebrow">Шаг 3 из 3</span>
                <Heading level={2}>Подтверждение</Heading>
              </VStack>
              <div className="summary">
                <div className="summary__row">
                  <span>Услуга</span>
                  <span>{service.name}</span>
                </div>
                <div className="summary__row">
                  <span>Когда</span>
                  <span>{startLabel}</span>
                </div>
                <div className="summary__row">
                  <span>Мастер</span>
                  <span>
                    {effectiveMaster ? (
                      <HStack gap={1} vAlign="center" hAlign="end">
                        <Avatar src={effectiveMaster.photo_url} name={effectiveMaster.name} size="xsm" tooltip={false} />
                        {effectiveMaster.name}
                      </HStack>
                    ) : (
                      'Любой свободный'
                    )}
                  </span>
                </div>
                <div className="summary__row">
                  <span>Стоимость</span>
                  <span>{priceLabel(service.price, tenant.currency, service.price_is_from)}</span>
                </div>
                <Button label="Изменить время" variant="ghost" size="sm" onClick={() => go('time')} />
              </div>
              <VStack gap={3}>
                <TextInput
                  label="Имя"
                  value={contact.name}
                  onChange={(v) => setContact((c) => ({ ...c, name: v }))}
                  autoComplete="name"
                  isRequired
                  size="lg"
                  status={errors.name ? { type: 'error', message: errors.name } : undefined}
                />
                <PhoneInput
                  label="Телефон"
                  value={contact.phone}
                  onChange={(v) => setContact((c) => ({ ...c, phone: v }))}
                  isRequired
                  size="lg"
                  placeholder={phoneExample(tenant.phone)}
                  description="Позвоним, только если что-то изменится"
                  status={errors.phone ? { type: 'error', message: errors.phone } : undefined}
                />
                <TextArea
                  label="Комментарий"
                  isOptional
                  value={contact.notes}
                  onChange={(v) => setContact((c) => ({ ...c, notes: v }))}
                  rows={2}
                  maxLength={500}
                  placeholder="Например: первый раз, чувствительная кожа"
                />
              </VStack>
              {book.isError && !(book.error instanceof AppError && ['slot_taken', 'slot_invalid', 'validation'].includes(book.error.code)) && (
                <Banner status="error" title="Запись не создана" description={`${errorText(book.error)} Нажмите ещё раз — дубля не будет.`} collapsible={false} />
              )}
              <Text type="supporting">
                Отмена онлайн — не позднее чем за {tenant.cancel_hours} ч. Нажимая «Записаться», вы соглашаетесь на обработку имени и телефона для этой записи.
              </Text>
              <div className="sheet-footer">
                <Button ref={submitRef as never} label="Записаться" variant="primary" size="lg" width="100%" isLoading={book.isPending} onClick={submit} />
              </div>
            </VStack>
          )}
        </BottomSheet>
      </BottomSheetSwitcher>
    </>
  );
}
