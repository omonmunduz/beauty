// pnpm tenants:build [slug...] — regenerate public/t/<slug> photos and public/s/<slug> PWA assets.
// Runs automatically before `dev` and `build`. Generated folders are not committed.
import { buildTenantAssets } from './lib/assets.ts';
import { listTenantSlugs, loadTenant, parseArgs, printReport } from './lib/tenants.ts';

const { positional } = parseArgs();
const slugs = positional.length ? positional : listTenantSlugs();
let failed = 0;
for (const slug of slugs) {
  const r = await loadTenant(slug);
  if (!r.business) {
    console.error(`• ${slug}: пропущено`);
    printReport(r);
    failed++;
    continue;
  }
  await buildTenantAssets(r.business);
  console.log(`• ${slug}: ассеты готовы (public/t/${slug}, public/s/${slug})`);
}
process.exit(failed ? 1 : 0);
