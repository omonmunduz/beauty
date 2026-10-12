import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { CaretRight, Plus } from '@phosphor-icons/react';
import { errorText, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { uploadTenantImage } from '@/lib/upload';
import { fieldErrors } from '@/lib/validation';
import { NumberField } from '@/components/fields';
import { ErrorBlock, LoadingBlock } from '@/components/ui';
import { useOwner } from '../OwnerRoot';
import { useCatalog, type OwnerResource } from '../catalog';
import { FilePickButton } from './MediaSection';
import { useRefreshStudio } from './SettingsSection';

const schema = z.object({
  name: z.string().trim().min(1, 'Имя обязательно').max(80),
  role_title: z.string().max(80),
  bio: z.string().max(400),
  experience_years: z.union([z.literal(''), z.coerce.number().int().min(0).max(80)]),
  active: z.boolean(),
});

function MasterEditor({ master, onClose }: { master: OwnerResource | null; onClose: () => void }) {
  const { tenant } = useOwner();
  const refresh = useRefreshStudio();
  const toast = useToast();
  const [f, setF] = useState({
    name: master?.name ?? '',
    role_title: master?.role_title ?? '',
    bio: master?.bio ?? '',
    experience_years: master?.experience_years != null ? String(master.experience_years) : '',
    active: master?.active ?? true,
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);
  const errors = touched ? fieldErrors(schema, f) : {};

  const save = useMutation({
    mutationFn: async () => {
      const p = schema.parse(f);
      const row: Record<string, unknown> = { ...p, experience_years: p.experience_years === '' ? null : p.experience_years };
      if (photo) {
        row.photo_url = await uploadTenantImage(tenant.id, 'masters', photo);
        row.photo_source = 'owner';
      }
      const res = master
        ? await supabase.from('resources').update(row).eq('id', master.id)
        : await supabase.from('resources').insert({ ...row, tenant_id: tenant.id, kind: 'master', sort: 1000 });
      if (res.error) throw toAppError(res.error);
    },
    onSuccess: async () => {
      await refresh();
      toast({ body: master ? 'Мастер обновлён' : 'Мастер добавлен — отметьте его услуги в разделе «Услуги»' });
      onClose();
    },
  });

  return (
    <BottomSheet isOpen onOpenChange={(o) => !o && onClose()} label={master ? 'Изменить мастера' : 'Новый мастер'} height="tall" padding={4} purpose="form">
      <VStack gap={3}>
        <Heading level={2}>{master ? master.name : 'Новый мастер'}</Heading>
        <HStack gap={3} vAlign="center">
          <Avatar src={photo ? URL.createObjectURL(photo) : master?.photo_url} name={f.name || '?'} size="lg" tooltip={false} />
          <FilePickButton label={master?.photo_url || photo ? 'Заменить фото' : 'Добавить фото'} onFile={setPhoto} />
        </HStack>
        <TextInput label="Имя и фамилия" value={f.name} onChange={(v) => setF({ ...f, name: v })} status={errors.name ? { type: 'error', message: errors.name } : undefined} />
        <TextInput label="Специализация" value={f.role_title} onChange={(v) => setF({ ...f, role_title: v })} placeholder="Например, мастер шугаринга" />
        <NumberField label="Опыт, лет" isOptional value={f.experience_years} onChange={(v) => setF({ ...f, experience_years: v })} />
        <TextArea label="О мастере" isOptional value={f.bio} onChange={(v) => setF({ ...f, bio: v })} rows={3} maxLength={400} />
        <Switch label="Принимает записи" value={f.active} onChange={(v) => setF({ ...f, active: v })} description="Выключите на время увольнения или долгого отпуска. Для отдельных дней используйте блокировку в расписании." />
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

export function MastersSection() {
  const { tenant } = useOwner();
  const catalog = useCatalog(tenant.id);
  const [editing, setEditing] = useState<OwnerResource | 'new' | null>(null);
  if (catalog.isPending) return <LoadingBlock />;
  if (catalog.isError) return <ErrorBlock error={catalog.error} onRetry={() => catalog.refetch()} />;
  return (
    <VStack gap={4}>
      <Button label="Добавить мастера" icon={<Plus size={18} />} variant="primary" onClick={() => setEditing('new')} />
      <div className="settings-list">
        {catalog.data.resources.map((r) => (
          <button key={r.id} type="button" className="settings-item tap" onClick={() => setEditing(r)} style={{ gridTemplateColumns: '44px 1fr auto', opacity: r.active ? 1 : 0.55 }}>
            <Avatar src={r.photo_url} name={r.name} size="lg" tooltip={false} />
            <span>
              <span style={{ display: 'block', fontWeight: 650 }}>{r.name}</span>
              <Text type="supporting">
                {r.role_title || 'Мастер'}
                {r.active ? '' : ' · не принимает записи'}
              </Text>
            </span>
            <CaretRight size={16} aria-hidden />
          </button>
        ))}
      </div>
      {editing && <MasterEditor master={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </VStack>
  );
}
