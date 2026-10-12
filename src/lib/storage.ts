// Per-device storage for anonymous clients: the access tokens of their own bookings.
// localStorage can be unavailable (private mode, blocked site data) — every access is guarded
// and the app still works, the user just has to keep the booking link.

export interface SavedBooking {
  id: string;
  token: string;
  startsAt: string;
  serviceName: string;
  savedAt: string;
}

const key = (slug: string) => `beauty:${slug}:bookings`;

function read<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(k: string, value: unknown): boolean {
  try {
    localStorage.setItem(k, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function savedBookings(slug: string): SavedBooking[] {
  const list = read<SavedBooking[]>(key(slug), []);
  return Array.isArray(list) ? list.filter((b) => typeof b.token === 'string' && /^[0-9a-f]{64}$/.test(b.token)) : [];
}

export function saveBooking(slug: string, b: SavedBooking): boolean {
  const list = savedBookings(slug).filter((x) => x.id !== b.id);
  return write(key(slug), [b, ...list].slice(0, 20));
}

export function forgetBooking(slug: string, id: string) {
  write(key(slug), savedBookings(slug).filter((x) => x.id !== id));
}

// Booking-in-progress draft survives an accidental reload (contacts only, no tokens).
export function loadDraft(slug: string): { name: string; phone: string } {
  return read(`beauty:${slug}:contact`, { name: '', phone: '' });
}

export function saveDraft(slug: string, draft: { name: string; phone: string }) {
  write(`beauty:${slug}:contact`, draft);
}

/** Wipe everything the owner cabinet may have left on this device. */
export function clearOwnerData() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('beauty-owner') || k.startsWith('sb-'))) localStorage.removeItem(k);
    }
    sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
}
