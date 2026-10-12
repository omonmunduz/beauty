/// <reference lib="webworker" />
// One worker source for every studio. It is copied to /s/<slug>/sw.js at build time; the slug
// is derived from its own scope, so each studio gets separate cache names and its own shell.
// Supabase API responses are never cached: personal data stays out of the worker.
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { setCacheNameDetails } from 'workbox-core';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

const scope = new URL(self.registration.scope).pathname; // "/s/<slug>/"
const slug = scope.split('/')[2] || 'root';
setCacheNameDetails({ prefix: `beauty-${slug}`, suffix: 'v1' });

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const SHELL_CACHE = `beauty-${slug}-shell`;
const SHELL_URL = `${scope}index.html`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.add(SHELL_URL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Navigations: always try the network (fresh HTML + tenant meta), fall back to this studio's shell.
registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      try {
        const res = await fetch(request);
        if (res.ok) (await caches.open(SHELL_CACHE)).put(SHELL_URL, res.clone());
        return res;
      } catch {
        return (await caches.match(SHELL_URL, { cacheName: SHELL_CACHE })) ?? Response.error();
      }
    },
    { allowlist: [new RegExp(`^${scope}`)] },
  ),
);

// Studio photos and icons (static config images + owner uploads in public storage).
registerRoute(
  ({ url, request }) =>
    request.destination === 'image' && (url.pathname.startsWith(`/t/${slug}/`) || url.pathname.startsWith(scope) || url.pathname.includes('/storage/v1/object/public/')),
  new CacheFirst({
    cacheName: `beauty-${slug}-images`,
    plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600 })],
  }),
);

registerRoute(
  ({ url }) => url.pathname === `${scope}manifest.webmanifest`,
  new NetworkFirst({ cacheName: `beauty-${slug}-meta` }),
);

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Напоминание о записи', {
      body: data.body ?? '',
      tag: data.tag,
      icon: `${scope}icons/icon-192.png`,
      badge: `${scope}icons/icon-192.png`,
      data: { url: data.url ?? `${scope}me` },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string })?.url ?? `${scope}me`, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => w.url.startsWith(self.location.origin + scope));
      if (existing) {
        await existing.focus();
        return existing.navigate(target);
      }
      return self.clients.openWindow(target);
    })(),
  );
});
