import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { businessSchema, type Business } from '../../shared/business-schema.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const TENANTS_DIR = path.join(ROOT, 'tenants');
export const PUBLIC_DIR = path.join(ROOT, 'public');

export const APP_BACKGROUND = '#0B0A0C';

export function listTenantSlugs(): string[] {
  if (!fs.existsSync(TENANTS_DIR)) return [];
  return fs
    .readdirSync(TENANTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(TENANTS_DIR, d.name, 'business.json')))
    .map((d) => d.name)
    .sort();
}

export interface LoadResult {
  slug: string;
  dir: string;
  business?: Business;
  errors: string[];
  warnings: string[];
}

/** Parse + validate business.json and every referenced image. */
export async function loadTenant(slug: string): Promise<LoadResult> {
  const dir = path.join(TENANTS_DIR, slug);
  const res: LoadResult = { slug, dir, errors: [], warnings: [] };
  const file = path.join(dir, 'business.json');
  if (!fs.existsSync(file)) {
    res.errors.push(`нет файла ${path.relative(ROOT, file)}`);
    return res;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    res.errors.push(`business.json: невалидный JSON (${(e as Error).message})`);
    return res;
  }
  const parsed = businessSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) res.errors.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
    return res;
  }
  const b = parsed.data;
  if (b.slug !== slug) res.errors.push(`slug "${b.slug}" не совпадает с папкой tenants/${slug}`);

  const images: { rel: string; minWidth: number; label: string }[] = [
    { rel: b.images.hero, minWidth: 900, label: 'images.hero' },
    ...(b.images.logo ? [{ rel: b.images.logo, minWidth: 256, label: 'images.logo' }] : []),
    ...b.masters.filter((m) => m.photo).map((m) => ({ rel: m.photo!, minWidth: 240, label: `masters.${m.key}.photo` })),
    ...b.gallery.map((g) => ({ rel: g.image, minWidth: 600, label: `gallery.${g.key}.image` })),
  ];
  for (const img of images) {
    const abs = path.join(dir, img.rel);
    if (!fs.existsSync(abs)) {
      res.errors.push(`${img.label}: файл ${img.rel} не найден`);
      continue;
    }
    try {
      const meta = await sharp(abs).metadata();
      if ((meta.width ?? 0) < img.minWidth) {
        res.warnings.push(`${img.label}: ширина ${meta.width}px, рекомендуем от ${img.minWidth}px`);
      }
    } catch {
      res.errors.push(`${img.label}: файл ${img.rel} не читается как изображение`);
    }
  }
  if (b.gallery.length < 3) res.warnings.push('в галерее меньше трёх работ');
  const today = new Date().toISOString().slice(0, 10);
  if (b.exceptions.some((e) => e.date < today)) res.warnings.push('есть исключения графика в прошлом — их можно удалить');
  if (!res.errors.length) res.business = b;
  return res;
}

export function printReport(r: LoadResult) {
  for (const e of r.errors) console.error(`  ✗ ${e}`);
  for (const w of r.warnings) console.warn(`  ! ${w}`);
  if (!r.errors.length) console.log(`  ✓ ${r.slug}: конфигурация корректна`);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags.set(k!, v);
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) flags.set(k!, argv[++i]!);
      else flags.set(k!, true);
    } else positional.push(a);
  }
  return { flags, positional };
}

// BEAUTY_ENV=production makes every pipeline script target the cloud project from
// .env.production.local instead of the local stack.
export function loadEnvFile(file = path.join(ROOT, process.env.BEAUTY_ENV === 'production' ? '.env.production.local' : '.env.local')) {
  for (const f of [file, path.join(ROOT, '.env')]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
}

export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
