// The single input contract for a studio: tenants/<slug>/business.json.
// Shared by the pipeline scripts (validation, publish, seed) and by tests.
import { z } from 'zod';

export const INFO_CARD_ICONS = [
  'sparkle', 'shield-check', 'leaf', 'clock', 'heart', 'drop', 'thermometer',
  'star', 'certificate', 'gift', 'lightning', 'hand-heart', 'snowflake', 'flower',
] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'время в формате ЧЧ:ММ');
const range = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, 'интервал в формате 10:00-21:00')
  .refine((v) => v.split('-')[0]! < v.split('-')[1]!, 'закрытие должно быть позже открытия');
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, 'ключ: латиница, цифры и дефис');
const imagePath = z.string().regex(/^images\/[A-Za-z0-9/_.-]+\.(jpe?g|png|webp|svg)$/i, 'путь вида images/xxx.jpg');

const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const businessSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'slug: латиница, цифры, дефис'),
    niche: z.string().default('depilation'),
    name: z.string().min(1).max(80),
    short_name: z.string().min(1).max(12).optional(),
    tagline: z.string().max(140).default(''),
    about: z.string().max(1200).default(''),
    timezone: z.string().refine(isTimezone, 'неизвестный часовой пояс IANA'),
    currency: z.string().regex(/^[A-Z]{3}$/).default('RUB'),
    locale: z.string().default('ru-RU'),
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'акцент в формате #RRGGBB'),
    contacts: z.object({
      phone: z.string().min(5),
      whatsapp: z.string().default(''),
      telegram: z.string().default(''),
      instagram: z.string().default(''),
    }),
    address: z.object({
      text: z.string().min(3),
      note: z.string().default(''),
      map_url: z.union([z.literal(''), z.url()]).default(''),
    }),
    policy: z
      .object({
        cancel_hours: z.number().int().min(0).max(168).default(12),
        slot_step_min: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).default(15),
        horizon_days: z.number().int().min(1).max(180).default(30),
        min_lead_min: z.number().int().min(0).max(2880).default(60),
      })
      .default({ cancel_hours: 12, slot_step_min: 15, horizon_days: 30, min_lead_min: 60 }),
    hours: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, range.nullable()])) as Record<(typeof WEEKDAYS)[number], z.ZodNullable<typeof range>>),
    exceptions: z
      .array(z.object({ date: z.iso.date(), hours: range.nullable(), note: z.string().default('') }))
      .default([]),
    info_cards: z
      .array(z.object({ icon: z.enum(INFO_CARD_ICONS), title: z.string().min(1).max(40), text: z.string().max(160) }))
      .length(3, 'нужно ровно три информационные карточки'),
    images: z.object({ hero: imagePath, logo: imagePath.nullable().default(null) }),
    masters: z
      .array(
        z.object({
          key,
          name: z.string().min(1).max(80),
          role_title: z.string().max(80).default(''),
          bio: z.string().max(400).default(''),
          experience_years: z.number().int().min(0).max(80).nullable().default(null),
          photo: imagePath.nullable().default(null),
        }),
      )
      .min(1, 'нужен хотя бы один мастер'),
    services: z
      .array(
        z.object({
          key,
          category: z.string().min(1).max(40),
          name: z.string().min(1).max(120),
          description: z.string().max(400).default(''),
          duration_min: z.number().int().min(5).max(4320),
          buffer_min: z.number().int().min(0).max(240).default(0),
          price: z.number().min(0),
          price_is_from: z.boolean().default(false),
          allow_overnight: z.boolean().default(false),
          popular: z.boolean().default(false),
          masters: z.array(key).min(1, 'у услуги должен быть мастер'),
        }),
      )
      .min(1, 'нужна хотя бы одна услуга'),
    gallery: z.array(z.object({ key, image: imagePath, caption: z.string().max(140).default('') })).default([]),
    demo: z.object({ bookings: z.number().int().min(0).max(200).default(24) }).default({ bookings: 24 }),
  })
  .superRefine((b, ctx) => {
    const masterKeys = new Set(b.masters.map((m) => m.key));
    const dup = (arr: { key: string }[], path: string) => {
      const seen = new Set<string>();
      arr.forEach((x, i) => {
        if (seen.has(x.key)) ctx.addIssue({ code: 'custom', path: [path, i, 'key'], message: `повтор ключа ${x.key}` });
        seen.add(x.key);
      });
    };
    dup(b.masters, 'masters');
    dup(b.services, 'services');
    dup(b.gallery, 'gallery');
    b.services.forEach((s, i) =>
      s.masters.forEach((m) => {
        if (!masterKeys.has(m)) ctx.addIssue({ code: 'custom', path: ['services', i, 'masters'], message: `нет мастера ${m}` });
      }),
    );
    if (!Object.values(b.hours).some(Boolean)) ctx.addIssue({ code: 'custom', path: ['hours'], message: 'нет ни одного рабочего дня' });
  });

export type Business = z.infer<typeof businessSchema>;

/** Public URL of a config image after the asset step converts it (served by the static build). */
export function configImageUrl(slug: string, image: string, ext = 'webp'): string {
  return `/t/${slug}/${image.replace(/^images\//, '').replace(/\.[a-z]+$/i, '')}.${ext}`;
}

/** Normalized payload consumed by private.apply_business_config(jsonb). */
export function toDbPayload(b: Business) {
  const split = (r: string) => r.split('-') as [string, string];
  return {
    slug: b.slug,
    niche: b.niche,
    name: b.name,
    tagline: b.tagline,
    about: b.about,
    timezone: b.timezone,
    currency: b.currency,
    locale: b.locale,
    accent: b.accent,
    phone: b.contacts.phone,
    whatsapp: b.contacts.whatsapp,
    telegram: b.contacts.telegram,
    instagram: b.contacts.instagram,
    address: b.address.text,
    address_note: b.address.note,
    map_url: b.address.map_url,
    info_cards: b.info_cards,
    cancel_hours: b.policy.cancel_hours,
    slot_step_min: b.policy.slot_step_min,
    horizon_days: b.policy.horizon_days,
    min_lead_min: b.policy.min_lead_min,
    hero_url: configImageUrl(b.slug, b.images.hero),
    logo_url: b.images.logo ? `/s/${b.slug}/icons/logo.png` : '',
    hours: WEEKDAYS.flatMap((d, i) => {
      const r = b.hours[d];
      if (!r) return [];
      const [opens, closes] = split(r);
      return [{ weekday: i + 1, opens, closes }];
    }),
    exceptions: b.exceptions.map((e) => {
      const [opens, closes] = e.hours ? split(e.hours) : [null, null];
      return { date: e.date, opens, closes, note: e.note };
    }),
    masters: b.masters.map((m) => ({
      key: m.key,
      name: m.name,
      role_title: m.role_title,
      bio: m.bio,
      experience_years: m.experience_years,
      photo_url: m.photo ? configImageUrl(b.slug, m.photo) : '',
    })),
    services: b.services,
    gallery: b.gallery.map((g) => ({ key: g.key, caption: g.caption, image_url: configImageUrl(b.slug, g.image) })),
  };
}

export { hhmm };
