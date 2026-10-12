// Per-tenant static assets: optimized photos, icons, maskable icon, apple-touch icon,
// iOS startup images and the web app manifest. All derived from tenants/<slug>/.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Business } from '../../shared/business-schema.ts';
import { APP_BACKGROUND, PUBLIC_DIR, TENANTS_DIR } from './tenants.ts';

export const SPLASH_SIZES = [
  { w: 1320, h: 2868, dw: 440, dh: 956, r: 3 },
  { w: 1206, h: 2622, dw: 402, dh: 874, r: 3 },
  { w: 1290, h: 2796, dw: 430, dh: 932, r: 3 },
  { w: 1179, h: 2556, dw: 393, dh: 852, r: 3 },
  { w: 1284, h: 2778, dw: 428, dh: 926, r: 3 },
  { w: 1170, h: 2532, dw: 390, dh: 844, r: 3 },
  { w: 1125, h: 2436, dw: 375, dh: 812, r: 3 },
  { w: 828, h: 1792, dw: 414, dh: 896, r: 2 },
  { w: 750, h: 1334, dw: 375, dh: 667, r: 2 },
] as const;

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

function monogramSvg(b: Business, size: number, scale: number) {
  const letter = escapeXml((b.short_name ?? b.name).trim().charAt(0).toUpperCase());
  const r = (size / 2) * 0.74 * scale;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><radialGradient id="g" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${b.accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${APP_BACKGROUND}" stop-opacity="0"/></radialGradient></defs>
  <rect width="${size}" height="${size}" fill="${APP_BACKGROUND}"/>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${b.accent}" stroke-opacity="0.45" stroke-width="${size * 0.008}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${size * 0.46 * scale}" fill="${b.accent}">${letter}</text>
</svg>`);
}

async function iconBuffer(b: Business, dir: string, size: number, safeScale: number): Promise<Buffer> {
  if (b.images.logo) {
    const inner = Math.round(size * 0.72 * safeScale);
    const logo = await sharp(path.join(dir, b.images.logo)).resize(inner, inner, { fit: 'contain', background: APP_BACKGROUND }).toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: APP_BACKGROUND } })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toBuffer();
  }
  return sharp(monogramSvg(b, size, safeScale)).png().toBuffer();
}

function splashSvg(b: Business, w: number, h: number) {
  const name = escapeXml(b.name);
  const tag = escapeXml(b.tagline.length > 60 ? `${b.tagline.slice(0, 57)}…` : b.tagline);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${APP_BACKGROUND}"/>
  <text x="50%" y="${h * 0.56}" text-anchor="middle" font-family="Georgia, serif" font-size="${w * 0.075}" fill="#F4EEF0">${name}</text>
  <text x="50%" y="${h * 0.56 + w * 0.07}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${w * 0.032}" fill="#A79FA4">${tag}</text>
</svg>`);
}

export function manifestFor(b: Business) {
  const base = `/s/${b.slug}/`;
  return {
    id: base,
    name: b.name,
    short_name: b.short_name ?? b.name.slice(0, 12),
    description: b.tagline,
    lang: b.locale.split('-')[0],
    start_url: base,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    background_color: APP_BACKGROUND,
    theme_color: APP_BACKGROUND,
    categories: ['beauty', 'lifestyle'],
    icons: [
      { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Записаться', url: `${base}book`, icons: [{ src: `${base}icons/icon-192.png`, sizes: '192x192' }] },
      { name: 'Мои записи', url: `${base}me` },
    ],
  };
}

/** <head> block injected into the tenant's HTML shell. */
export function headFor(b: Business, ogImage: string) {
  const base = `/s/${b.slug}/`;
  const e = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const splash = SPLASH_SIZES.map(
    (s) =>
      `<link rel="apple-touch-startup-image" href="${base}splash/${s.w}x${s.h}.png" media="(device-width: ${s.dw}px) and (device-height: ${s.dh}px) and (-webkit-device-pixel-ratio: ${s.r}) and (orientation: portrait)">`,
  ).join('\n    ');
  return `<title>${e(b.name)} — онлайн-запись</title>
    <meta name="description" content="${e(b.tagline)}">
    <meta name="theme-color" content="${APP_BACKGROUND}">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="${e(b.short_name ?? b.name)}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${e(b.name)}">
    <meta property="og:description" content="${e(b.tagline)}">
    <meta property="og:image" content="${ogImage}">
    <meta name="tenant" content="${b.slug}">
    <link rel="manifest" href="${base}manifest.webmanifest">
    <link rel="icon" type="image/png" sizes="32x32" href="${base}icons/favicon-32.png">
    <link rel="apple-touch-icon" href="${base}icons/apple-touch-icon.png">
    ${splash}`;
}

async function toWebp(src: string, dest: string, maxWidth: number) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sharp(src).rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 80, effort: 5 }).toFile(dest);
}

export async function buildTenantAssets(b: Business) {
  const dir = path.join(TENANTS_DIR, b.slug);
  const photoOut = path.join(PUBLIC_DIR, 't', b.slug);
  const appOut = path.join(PUBLIC_DIR, 's', b.slug);
  fs.rmSync(photoOut, { recursive: true, force: true });
  fs.rmSync(appOut, { recursive: true, force: true });

  const rel = (p: string) => p.replace(/^images\//, '').replace(/\.[a-z]+$/i, '');
  await toWebp(path.join(dir, b.images.hero), path.join(photoOut, `${rel(b.images.hero)}.webp`), 1600);
  await sharp(path.join(dir, b.images.hero)).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(
    (fs.mkdirSync(photoOut, { recursive: true }), path.join(photoOut, 'og.jpg')),
  );
  for (const m of b.masters) if (m.photo) await toWebp(path.join(dir, m.photo), path.join(photoOut, `${rel(m.photo)}.webp`), 480);
  for (const g of b.gallery) await toWebp(path.join(dir, g.image), path.join(photoOut, `${rel(g.image)}.webp`), 1200);

  const icons = path.join(appOut, 'icons');
  fs.mkdirSync(icons, { recursive: true });
  const write = async (name: string, size: number, scale: number) =>
    fs.writeFileSync(path.join(icons, name), await sharp(await iconBuffer(b, dir, 1024, scale)).resize(size, size).png().toBuffer());
  await write('icon-192.png', 192, 1);
  await write('icon-512.png', 512, 1);
  await write('maskable-512.png', 512, 0.78); // keep the mark inside the 80% safe zone
  await write('apple-touch-icon.png', 180, 0.9);
  await write('favicon-32.png', 32, 1.15);
  if (b.images.logo) await write('logo.png', 512, 1);

  const splash = path.join(appOut, 'splash');
  fs.mkdirSync(splash, { recursive: true });
  const mark = await sharp(await iconBuffer(b, dir, 1024, 1)).resize(360, 360).png().toBuffer();
  for (const s of SPLASH_SIZES) {
    const markSize = Math.round(s.w * 0.28);
    await sharp(splashSvg(b, s.w, s.h))
      .composite([{ input: await sharp(mark).resize(markSize, markSize).toBuffer(), top: Math.round(s.h * 0.56 - markSize * 1.35), left: Math.round((s.w - markSize) / 2) }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(splash, `${s.w}x${s.h}.png`));
  }

  fs.writeFileSync(path.join(appOut, 'manifest.webmanifest'), JSON.stringify(manifestFor(b), null, 2));
  fs.writeFileSync(path.join(appOut, 'head.html'), headFor(b, `/t/${b.slug}/og.jpg`));
}
