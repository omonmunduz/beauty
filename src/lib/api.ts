import { AppError, toAppError } from './errors';
import { functionsUrl, supabase, supabaseConfigured } from './supabase';
import type {
  AssistantReply, Availability, BookingResult, OwnerSchedule, OwnerStats, Payment, PublicBooking, Storefront, Tenant,
} from './types';

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabaseConfigured) throw new AppError('config', 'Приложение не подключено к базе: задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}

// ------------------------------------------------------------------ public
export const api = {
  storefront: (slug: string) => rpc<Storefront>('get_storefront', { p_slug: slug }),
  availability: (slug: string, serviceId: string, resourceId: string | null, from: string, days: number) =>
    rpc<Availability>('get_availability', { p_slug: slug, p_service_id: serviceId, p_resource_id: resourceId, p_from: from, p_days: days }),
  createBooking: (args: {
    slug: string; serviceId: string; resourceId: string | null; startsAt: string; name: string; phone: string; notes: string; idempotencyKey: string;
  }) =>
    rpc<BookingResult>('create_booking', {
      p_slug: args.slug, p_service_id: args.serviceId, p_resource_id: args.resourceId, p_starts_at: args.startsAt,
      p_name: args.name, p_phone: args.phone, p_notes: args.notes, p_idempotency_key: args.idempotencyKey,
    }),
  booking: (token: string) => rpc<PublicBooking>('get_booking', { p_token: token }),
  cancelBooking: (token: string, reason = '') => rpc<{ status: string }>('cancel_booking', { p_token: token, p_reason: reason }),
  savePush: (token: string, sub: PushSubscriptionJSON) =>
    rpc<{ ok: boolean }>('save_push_subscription', { p_token: token, p_endpoint: sub.endpoint, p_p256dh: sub.keys?.p256dh, p_auth: sub.keys?.auth }),
  deletePush: (token: string, endpoint: string) => rpc<{ ok: boolean }>('delete_push_subscription', { p_token: token, p_endpoint: endpoint }),

  // ---------------------------------------------------------------- owner
  ownerContext: (slug: string) => rpc<{ tenant: Tenant; role: string }>('owner_context', { p_slug: slug }),
  ownerSchedule: (tenantId: string, from: string, to: string) => rpc<OwnerSchedule>('owner_schedule', { p_tenant: tenantId, p_from: from, p_to: to }),
  ownerStats: (tenantId: string, from: string, to: string) => rpc<OwnerStats>('owner_stats', { p_tenant: tenantId, p_from: from, p_to: to }),
  ownerPayments: (bookingId: string) => rpc<Payment[]>('owner_booking_payments', { p_booking: bookingId }),
  ownerCreateBooking: (args: {
    tenantId: string; serviceId: string; resourceId: string | null; startsAt: string; name: string; phone: string; notes: string; idempotencyKey: string;
  }) =>
    rpc<BookingResult>('owner_create_booking', {
      p_tenant: args.tenantId, p_service_id: args.serviceId, p_resource_id: args.resourceId, p_starts_at: args.startsAt,
      p_name: args.name, p_phone: args.phone, p_notes: args.notes, p_idempotency_key: args.idempotencyKey,
    }),
  ownerReschedule: (bookingId: string, startsAt: string, resourceId: string | null) =>
    rpc<BookingResult>('owner_reschedule', { p_booking: bookingId, p_starts_at: startsAt, p_resource_id: resourceId }),
  ownerCancel: (bookingId: string, reason: string) => rpc<BookingResult>('owner_cancel_booking', { p_booking: bookingId, p_reason: reason }),
  ownerSetStatus: (bookingId: string, status: string) => rpc<BookingResult>('owner_set_status', { p_booking: bookingId, p_status: status }),
  ownerAddPayment: (args: { bookingId: string; kind: 'payment' | 'refund'; amount: number; method: string; note: string; idempotencyKey: string }) =>
    rpc<{ id: string }>('owner_add_payment', {
      p_booking: args.bookingId, p_kind: args.kind, p_amount: args.amount, p_method: args.method, p_note: args.note, p_idempotency_key: args.idempotencyKey,
    }),
  ownerBlock: (resourceId: string, from: string, to: string, note: string) =>
    rpc<{ id: string }>('owner_block_resource', { p_resource: resourceId, p_from: from, p_to: to, p_note: note }),
  ownerUnblock: (occupancyId: string) => rpc<{ ok: boolean }>('owner_unblock', { p_occupancy: occupancyId }),
  ownerReadiness: (tenantId: string) => rpc<string[]>('owner_readiness', { p_tenant: tenantId }),
  ownerGoLive: (tenantId: string) => rpc<{ status: string }>('owner_go_live', { p_tenant: tenantId }),
};

// ------------------------------------------------------------- assistant
export async function askAssistant(args: {
  slug: string;
  scope: 'client' | 'owner';
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<AssistantReply> {
  if (!supabaseConfigured) throw new AppError('config', 'Помощник не подключён.');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  };
  if (args.scope === 'owner') {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new AppError('forbidden');
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${functionsUrl}/assistant`, { method: 'POST', headers, body: JSON.stringify(args) });
  } catch (e) {
    throw toAppError(e);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 429) throw new AppError('rate_limited');
    throw new AppError(body.error ?? 'assistant', 'Помощник сейчас недоступен. Запись работает как обычно.');
  }
  return body as AssistantReply;
}
