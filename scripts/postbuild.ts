// Runs after `vite build`. One shared JS/CSS bundle; per studio we emit:
//   dist/s/<slug>/index.html  — shell with the studio's title, meta, manifest, icons, splash
//   dist/s/<slug>/sw.js       — same worker source, scoped to /s/<slug>/ with its own caches
//   dist/_redirects           — Cloudflare Pages deep links -> the right studio shell
//   dist/vercel.json is not used; vercel.json at the repo root does the same for Vercel.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/tenants.ts';

const DIST = path.join(ROOT, 'dist');
const shell = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const START = '<!--tenant-head:start-->';
const END = '<!--tenant-head:end-->';
if (!shell.includes(START) || !shell.includes(END)) throw new Error('index.html is missing tenant-head markers');
const sw = path.join(DIST, 'sw.js');
if (!fs.existsSync(sw)) throw new Error('dist/sw.js missing — vite-plugin-pwa did not run');

const sDir = path.join(DIST, 's');
const slugs = fs.existsSync(sDir) ? fs.readdirSync(sDir).filter((d) => fs.existsSync(path.join(sDir, d, 'head.html'))) : [];
const redirects: string[] = [];
// SPA routes inside a studio. Assets under /s/<slug>/ (icons, splash, sw.js, manifest) are real files.
const ROUTES = ['services', 'services/', 'book', 'book/', 'me', 'me/', 'chat', 'chat/', 'b/*', 'owner', 'owner/', 'owner/*'];

for (const slug of slugs) {
  const dir = path.join(sDir, slug);
  const head = fs.readFileSync(path.join(dir, 'head.html'), 'utf8');
  const html = shell.slice(0, shell.indexOf(START)) + head + shell.slice(shell.indexOf(END) + END.length);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.rmSync(path.join(dir, 'head.html'));
  fs.copyFileSync(sw, path.join(dir, 'sw.js'));
  if (fs.existsSync(`${sw}.map`)) fs.copyFileSync(`${sw}.map`, path.join(dir, 'sw.js.map'));
  // Cloudflare Pages serves /s/<slug>/ from index.html itself and 308-redirects explicit
  // "…/index.html" targets, so rewrites point at the directory URL.
  for (const r of ROUTES) redirects.push(`/s/${slug}/${r} /s/${slug}/ 200`);
  console.log(`• /s/${slug}/ shell + sw.js`);
}
// The root worker is only a build artifact; studios register their own scoped copy.
fs.rmSync(sw);
fs.rmSync(`${sw}.map`, { force: true });
fs.writeFileSync(path.join(DIST, '_redirects'), `${redirects.join('\n')}\n`);
fs.writeFileSync(
  path.join(DIST, '_headers'),
  `/s/*/sw.js
  Cache-Control: no-cache
/s/*/manifest.webmanifest
  Cache-Control: no-cache
  Content-Type: application/manifest+json
/s/*/index.html
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
// Vercel: real files win (filesystem first), everything else inside /s/<slug>/ gets that
// studio's own shell. Deployed as a prebuilt static folder: `vercel deploy dist --prod`.
fs.writeFileSync(
  path.join(DIST, 'vercel.json'),
  JSON.stringify(
    {
      cleanUrls: false,
      rewrites: [{ source: '/s/:slug/(.*)', destination: '/s/:slug/index.html' }],
      headers: [
        { source: '/s/:slug/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/s/:slug/' }] },
        { source: '/s/:slug/manifest.webmanifest', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Content-Type', value: 'application/manifest+json' }] },
        { source: '/s/:slug/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
        { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      ],
    },
    null,
    2,
  ),
);
console.log(`postbuild: ${slugs.length} студий, _redirects, _headers и vercel.json записаны`);
