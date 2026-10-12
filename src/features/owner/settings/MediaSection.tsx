import { useMutation } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { UploadSimple } from '@phosphor-icons/react';
import { errorText, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { uploadTenantImage } from '@/lib/upload';
import { Photo } from '@/components/ui';
import { useOwner } from '../OwnerRoot';
import { useRefreshStudio } from './SettingsSection';

export function FilePickButton({ label, onFile, isLoading }: { label: string; onFile: (f: File) => void; isLoading?: boolean }) {
  return (
    <span className="file-btn" style={{ display: 'inline-block' }}>
      <Button label={label} icon={<UploadSimple size={18} />} isLoading={isLoading} tabIndex={-1} />
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={label}
        disabled={isLoading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </span>
  );
}

// Owner uploads are marked hero_source/logo_source = 'owner', so re-publishing the studio
// config never replaces them.
export function MediaSection() {
  const { tenant } = useOwner();
  const refresh = useRefreshStudio();
  const toast = useToast();
  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: 'hero' | 'logo'; file: File }) => {
      const url = await uploadTenantImage(tenant.id, kind, file);
      const patch = kind === 'hero' ? { hero_url: url, hero_source: 'owner' } : { logo_url: url, logo_source: 'owner' };
      const { error } = await supabase.from('tenants').update(patch).eq('id', tenant.id);
      if (error) throw toAppError(error);
    },
    onSuccess: async (_d, v) => {
      await refresh();
      toast({ body: v.kind === 'hero' ? 'Главное фото обновлено' : 'Логотип обновлён' });
    },
  });
  return (
    <VStack gap={6}>
      <VStack gap={2}>
        <Heading level={3}>Главное фото</Heading>
        <figure className="photo-card" style={{ aspectRatio: '4 / 5', maxWidth: 320 }}>
          <Photo src={tenant.hero_url} alt="Главное фото студии" />
        </figure>
        <Text type="supporting">Вертикальное фото от 1200 px. Лицо или процедура — в верхней половине кадра.</Text>
        <FilePickButton label="Заменить главное фото" isLoading={upload.isPending && upload.variables?.kind === 'hero'} onFile={(file) => upload.mutate({ kind: 'hero', file })} />
      </VStack>
      <VStack gap={2}>
        <Heading level={3}>Логотип</Heading>
        {tenant.logo_url ? (
          <img src={tenant.logo_url} alt="Логотип" style={{ width: 96, height: 96, objectFit: 'contain', borderRadius: 20, background: 'var(--color-background-muted)' }} />
        ) : (
          <Text type="supporting">Сейчас используется монограмма из названия.</Text>
        )}
        <FilePickButton label="Загрузить логотип" isLoading={upload.isPending && upload.variables?.kind === 'logo'} onFile={(file) => upload.mutate({ kind: 'logo', file })} />
        <Text type="supporting">Иконка установленного приложения обновляется при следующей публикации студии.</Text>
      </VStack>
      {upload.isError && <Banner status="error" title="Не загружено" description={errorText(upload.error)} collapsible={false} />}
    </VStack>
  );
}
