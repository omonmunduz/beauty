// pnpm tenant:new <slug> [--name "Название"] [--from silk-room]
// Scaffolds tenants/<slug>/ from an existing studio (or the template) so the operator only
// edits business.json and drops photos into images/.
import fs from 'node:fs';
import path from 'node:path';
import { TENANTS_DIR, parseArgs } from './lib/tenants.ts';

const { flags, positional } = parseArgs();
const slug = positional[0];
if (!slug || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
  console.error('Использование: pnpm tenant:new <slug> [--name "Название"] [--from <slug>]\nslug — латиница, цифры, дефис.');
  process.exit(1);
}
const target = path.join(TENANTS_DIR, slug);
if (fs.existsSync(target)) {
  console.error(`tenants/${slug} уже существует — существующие студии не перезаписываются.`);
  process.exit(1);
}
const from = typeof flags.get('from') === 'string' ? (flags.get('from') as string) : '_template';
const source = path.join(TENANTS_DIR, from);
if (!fs.existsSync(path.join(source, 'business.json'))) {
  console.error(`Нет шаблона tenants/${from}/business.json`);
  process.exit(1);
}
fs.cpSync(source, target, { recursive: true });
const file = path.join(target, 'business.json');
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
json.slug = slug;
if (typeof flags.get('name') === 'string') {
  json.name = flags.get('name');
  json.short_name = String(flags.get('name')).slice(0, 12);
}
fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
console.log(`Создано tenants/${slug}/
Дальше:
  1. Отредактируйте tenants/${slug}/business.json (название, цены, мастера, график, адрес)
  2. Замените фото в tenants/${slug}/images/ (hero.jpg — главное, masters/, gallery/)
  3. pnpm tenant:check ${slug}
  4. pnpm tenant:publish ${slug}           # превью с демо-данными
  5. pnpm owner:create ${slug} owner@mail  # доступ в кабинет
  6. pnpm build && задеплойте dist/, затем pnpm tenant:verify ${slug} --url https://...`);
