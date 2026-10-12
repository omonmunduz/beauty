import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { errorText, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { uploadTenantImage } from '@/lib/upload';
import { ErrorBlock, LoadingBlock, Photo } from '@/components/ui';
import { ownerKey, useOwner } from '../OwnerRoot';
import { FilePickButton } from './MediaSection';
import { useRefreshStudio } from './SettingsSection';

interface Item {
  id: string;
  image_url: string;
  caption: string;
  source: 'config' | 'owner';
  sort: number;
}

// Three independent actions: add a new card, replace one card's photo, edit one card's caption.
// Each touches exactly one row; edited cards become owner-owned and survive config re-publish.
function Tile({ item, onChanged }: { item: Item; onChanged: () => Promise<unknown> }) {
  const { tenant } = useOwner();
  const toast = useToast();
  const [caption, setCaption] = useState(item.caption);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useMutation({
    mutationFn: async (patch: Partial<Item>) => {
      const { error } = await supabase.from('gallery_items').update({ ...patch, source: 'owner', updated_at: new Date().toISOString() }).eq('id', item.id);
      if (error) throw toAppError(error);
    },
    onSuccess: async () => {
      await onChanged();
      toast({ body: 'Карточка обновлена' });
    },
  });
  const replace = useMutation({
    mutationFn: async (file: File) => update.mutateAsync({ image_url: await uploadTenantImage(tenant.id, 'gallery', file) }),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('gallery_items').delete().eq('id', item.id);
      if (error) throw toAppError(error);
    },
    onSuccess: () => onChanged(),
  });
  const failed = update.error ?? replace.error ?? remove.error;
  return (
    <div className="gallery-tile">
      <Photo src={item.image_url} alt={item.caption || 'Фото работы'} />
      <FilePickButton label="Заменить фото" isLoading={replace.isPending} onFile={(f) => replace.mutate(f)} />
      <TextInput label="Подпись" isLabelHidden value={caption} onChange={setCaption} placeholder="Подпись под фото" size="sm" />
      <HStack gap={1}>
        <Button label="Сохранить подпись" size="sm" isDisabled={caption === item.caption} isLoading={update.isPending && !replace.isPending} onClick={() => update.mutate({ caption })} />
        <Button label="Удалить" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} />
      </HStack>
      {failed && <Text type="supporting">{errorText(failed)}</Text>}
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить карточку?"
        description="Фото исчезнет из раздела «Наши работы». Остальные карточки не изменятся."
        actionLabel="Удалить"
        cancelLabel="Оставить"
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate(undefined, { onSuccess: () => setConfirmDelete(false) })}
      />
    </div>
  );
}

export function GallerySection() {
  const { tenant } = useOwner();
  const refresh = useRefreshStudio();
  const toast = useToast();
  const q = useQuery({
    queryKey: ownerKey(tenant.id, 'gallery'),
    queryFn: async () => {
      const { data, error } = await supabase.from('gallery_items').select('id, image_url, caption, source, sort').eq('tenant_id', tenant.id).order('sort').order('created_at');
      if (error) throw toAppError(error);
      return data as Item[];
    },
  });
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newCaption, setNewCaption] = useState('');
  const add = useMutation({
    mutationFn: async () => {
      if (!newFile) throw new Error('Выберите фото');
      const url = await uploadTenantImage(tenant.id, 'gallery', newFile);
      const maxSort = Math.max(0, ...(q.data ?? []).map((i) => i.sort));
      const { error } = await supabase.from('gallery_items').insert({ tenant_id: tenant.id, image_url: url, caption: newCaption, source: 'owner', sort: maxSort + 1 });
      if (error) throw toAppError(error);
    },
    onSuccess: async () => {
      setNewFile(null);
      setNewCaption('');
      await refresh();
      toast({ body: 'Новая карточка добавлена в конец галереи' });
    },
  });

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  return (
    <VStack gap={6}>
      <VStack gap={2}>
        <Heading level={3}>Добавить новую карточку</Heading>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <FilePickButton label={newFile ? 'Другое фото' : 'Выбрать фото'} onFile={setNewFile} />
          {newFile && <Text type="supporting">{newFile.name}</Text>}
        </HStack>
        <TextInput label="Подпись" isOptional value={newCaption} onChange={setNewCaption} placeholder="Например, результат после 3 процедур" />
        {add.isError && <Banner status="error" title="Не добавлено" description={errorText(add.error) === 'Что-то пошло не так. Попробуйте ещё раз.' ? (add.error as Error).message : errorText(add.error)} collapsible={false} />}
        <Button label="Добавить карточку" variant="primary" isDisabled={!newFile} isLoading={add.isPending} onClick={() => add.mutate()} />
      </VStack>
      <VStack gap={2}>
        <Heading level={3}>Карточки ({q.data.length})</Heading>
        {q.data.length === 0 ? (
          <Text type="supporting">Пока нет фото работ.</Text>
        ) : (
          <div className="gallery-grid">
            {q.data.map((item) => (
              <Tile key={item.id} item={item} onChanged={refresh} />
            ))}
          </div>
        )}
      </VStack>
    </VStack>
  );
}
