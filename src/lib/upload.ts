import { AppError, toAppError } from './errors';
import { supabase } from './supabase';

const BUCKET = 'tenant-media';

async function compress(file: File, maxSide: number): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new AppError('file', 'Нужен файл изображения (JPG, PNG, WebP)');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new AppError('file', 'Не удалось прочитать изображение');
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
  if (!blob) throw new AppError('file', 'Не удалось сжать изображение');
  return blob;
}

/** Uploads into tenant-media/<tenantId>/<folder>/… — storage RLS only allows the tenant's members. */
export async function uploadTenantImage(tenantId: string, folder: 'hero' | 'logo' | 'masters' | 'gallery', file: File): Promise<string> {
  const blob = await compress(file, folder === 'logo' ? 1024 : 1800);
  const path = `${tenantId}/${folder}/${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (error) throw toAppError(error);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
