// Installation, per-studio service worker and Web Push capability detection.
// The worker lives at /s/<slug>/sw.js with scope /s/<slug>/, so every studio installs as a
// separate app with its own caches.

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: 'ios-not-installed' | 'unsupported' | 'denied' | 'no-worker' | 'not-configured' };

export function pushSupport(): PushSupport {
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) return { ok: false, reason: 'not-configured' };
  if (isIos() && !isStandalone()) return { ok: false, reason: 'ios-not-installed' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'unsupported' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  if (!import.meta.env.PROD) return { ok: false, reason: 'no-worker' };
  return { ok: true };
}

export async function registerStudioWorker(slug: string): Promise<ServiceWorkerRegistration | null> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(`/s/${slug}/sw.js`, { scope: `/s/${slug}/` });
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function subscribePush(slug: string): Promise<PushSubscriptionJSON> {
  const reg = (await navigator.serviceWorker.getRegistration(`/s/${slug}/`)) ?? (await registerStudioWorker(slug));
  if (!reg) throw new Error('no-worker');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('denied');
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY as string),
    }));
  return sub.toJSON();
}

// "Add to home screen" prompt (Chromium). iOS has no prompt — we show instructions instead.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}
export const installPrompt = {
  available: () => deferred !== null,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async prompt(): Promise<boolean> {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    listeners.forEach((l) => l());
    return outcome === 'accepted';
  },
};
