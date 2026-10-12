// Server-side tool implementations. Bound to one tenant (slug + verified tenant id) and to the
// caller's own Supabase client (anon for clients, the owner's JWT for owners), so database
// RLS/RPC checks still apply. The model never supplies the tenant, SQL or credentials.
import { humanDate, localTime, resolvePeriod, type PeriodKey } from '../periods.ts';
import { matchServices } from './router.ts';
import type { Executor, Scope, StudioContext, ToolInvocation } from './types.ts';

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Storefront {
  tenant: {
    id: string; slug: string; name: string; timezone: string; currency: string; phone: string; whatsapp: string;
    telegram: string; instagram: string; address: string; address_note: string; map_url: string; cancel_hours: number;
  };
  hours: { weekday: number; opens: string; closes: string }[];
  services: { id: string; name: string; category: string; price: number; price_is_from: boolean; duration_min: number; popular: boolean; resource_ids: string[] }[];
  resources: { id: string; name: string; role_title: string; experience_years: number | null }[];
}

const DAY = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function studioContext(sf: Storefront): StudioContext {
  return {
    slug: sf.tenant.slug,
    name: sf.tenant.name,
    timezone: sf.tenant.timezone,
    currency: sf.tenant.currency,
    services: sf.services.map((s) => ({ id: s.id, name: s.name, category: s.category, price: Number(s.price), duration_min: s.duration_min, popular: s.popular })),
    masters: sf.resources.map((r) => ({ id: r.id, name: r.name, role_title: r.role_title })),
  };
}

export function createExecutor(opts: { scope: Scope; storefront: Storefront; rpc: Rpc; tenantId?: string; now?: () => Date }): Executor {
  const { storefront: sf, rpc } = opts;
  const tz = sf.tenant.timezone;
  const now = opts.now ?? (() => new Date());
  const ctx = studioContext(sf);

  const range = (args: Record<string, unknown>, fallback: PeriodKey) => {
    if (typeof args.date_from === 'string' && typeof args.date_to === 'string' && args.date_from <= args.date_to) {
      return { from: args.date_from, to: args.date_to, label: `период ${args.date_from} — ${args.date_to}` };
    }
    return resolvePeriod((args.period as PeriodKey) ?? fallback, tz, now());
  };

  return async ({ name, args }: ToolInvocation) => {
    switch (name) {
      case 'studio_info':
        return {
          name: sf.tenant.name,
          address: sf.tenant.address,
          address_note: sf.tenant.address_note,
          map_url: sf.tenant.map_url,
          phone: sf.tenant.phone,
          whatsapp: sf.tenant.whatsapp,
          telegram: sf.tenant.telegram,
          instagram: sf.tenant.instagram,
          cancel_hours: sf.tenant.cancel_hours,
          timezone: tz,
          hours: DAY.map((day, i) => {
            const h = sf.hours.find((x) => x.weekday === i + 1);
            return { day, hours: h ? `${h.opens.slice(0, 5)}–${h.closes.slice(0, 5)}` : null };
          }),
        };
      case 'list_services': {
        const q = typeof args.query === 'string' ? args.query : '';
        const matched = q ? matchServices(q, ctx.services) : [];
        const ids = new Set(matched.map((m) => m.id));
        const list = (ids.size ? sf.services.filter((s) => ids.has(s.id)) : sf.services).map((s) => ({
          id: s.id, name: s.name, category: s.category, price: Number(s.price), price_is_from: s.price_is_from, duration_min: s.duration_min,
        }));
        return { services: list, filtered: ids.size > 0, total: sf.services.length };
      }
      case 'list_masters':
        return { masters: sf.resources.map((r) => ({ id: r.id, name: r.name, role_title: r.role_title, experience_years: r.experience_years })) };
      case 'find_slots': {
        const wanted = String(args.service);
        const service = sf.services.find((s) => s.id === wanted) ?? (() => {
          const m = matchServices(wanted, ctx.services);
          return m.length ? sf.services.find((s) => s.id === m[0]!.id) : undefined;
        })();
        if (!service) return { error: 'service_not_found', candidates: sf.services.slice(0, 6).map((s) => s.name) };
        const masterArg = typeof args.master === 'string' ? args.master.toLowerCase() : '';
        const master = masterArg ? sf.resources.find((r) => r.id === args.master || r.name.toLowerCase().includes(masterArg)) : undefined;
        const avail = await rpc('get_availability', {
          p_slug: sf.tenant.slug,
          p_service_id: service.id,
          p_resource_id: master?.id ?? null,
          p_from: args.date_from ?? null,
          p_days: args.days ?? 7,
        });
        const days = (avail.days as { date: string; is_open: boolean; slots: { start: string; free: boolean }[] }[])
          .map((d) => {
            const free = d.slots.filter((s) => s.free);
            return { date: d.date, label: humanDate(d.date, tz, now()), is_open: d.is_open, times: free.map((s) => localTime(s.start, tz)), starts: free.map((s) => s.start) };
          })
          .filter((d) => d.times.length)
          .slice(0, 3);
        return {
          service: { id: service.id, name: service.name, price: Number(service.price), duration_min: service.duration_min },
          master: master ? { id: master.id, name: master.name } : null,
          timezone: tz,
          days,
          booking_url: `/s/${sf.tenant.slug}/book?service=${service.id}${master ? `&master=${master.id}` : ''}`,
        };
      }
      case 'owner_schedule': {
        if (opts.scope !== 'owner' || !opts.tenantId) throw new Error('owner scope required');
        const period = range(args, 'today');
        const data = await rpc('owner_schedule', { p_tenant: opts.tenantId, p_from: period.from, p_to: period.to });
        const bookings = (data.bookings as any[]).map((b) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
          date_label: humanDate(new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(b.starts_at)), tz, now()),
          time: localTime(b.starts_at, tz),
          client: b.client_name,
          service: b.service_name,
          master: b.resource_name,
          status: b.status,
          price: Number(b.price),
          paid: Number(b.paid) - Number(b.refunded),
          demo: b.is_demo,
        }));
        return { period, bookings, blocks: (data.blocks as unknown[]).length };
      }
      case 'owner_stats': {
        if (opts.scope !== 'owner' || !opts.tenantId) throw new Error('owner scope required');
        const period = range(args, 'week');
        const s = await rpc('owner_stats', { p_tenant: opts.tenantId, p_from: period.from, p_to: period.to });
        return {
          period,
          visits: s.visits,
          completed: s.completed,
          booked: s.booked,
          cancelled: s.cancelled,
          no_show: s.no_show,
          received: Number(s.received),
          payments_total: Number(s.payments_total),
          refunds_total: Number(s.refunds_total),
          expected: Number(s.expected),
          currency: sf.tenant.currency,
        };
      }
    }
  };
}
