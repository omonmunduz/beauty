// pnpm tenant:check <slug>|--all   — validate business.json and images, no side effects.
import { listTenantSlugs, loadTenant, parseArgs, printReport } from './lib/tenants.ts';

const { flags, positional } = parseArgs();
const slugs = flags.has('all') || !positional.length ? listTenantSlugs() : positional;
if (!slugs.length) {
  console.error('Нет студий в tenants/. Создайте: pnpm tenant:new <slug>');
  process.exit(1);
}
let failed = 0;
for (const slug of slugs) {
  console.log(`• ${slug}`);
  const r = await loadTenant(slug);
  printReport(r);
  if (r.errors.length) failed++;
}
process.exit(failed ? 1 : 0);
