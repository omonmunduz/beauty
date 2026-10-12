import { z } from 'zod';

const digits = (s: string) => s.replace(/\D/g, '');

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя').max(80, 'Слишком длинное имя'),
  phone: z
    .string()
    .trim()
    .refine((v) => digits(v).length >= 10 && digits(v).length <= 15, 'Укажите номер с кодом страны, например +996 700 123 456'),
  notes: z.string().max(500, 'До 500 символов').default(''),
});
export type ContactInput = z.infer<typeof contactSchema>;

export function fieldErrors<T>(schema: z.ZodType<T>, value: unknown): Partial<Record<string, string>> {
  const r = schema.safeParse(value);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? '_');
    out[k] ??= i.message;
  }
  return out;
}

/** "+7 (916) 111-22-33" for Russian numbers, untouched otherwise. */
export function formatPhone(raw: string): string {
  let d = digits(raw);
  if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`;
  if (d.length === 10 && d.startsWith('9')) d = `7${d}`;
  if (d.length !== 11 || !d.startsWith('7')) return raw.trim();
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

export const loginSchema = z.object({
  email: z.email('Проверьте почту'),
  password: z.string().min(6, 'Минимум 6 символов'),
});

export const moneySchema = z.coerce.number().positive('Сумма больше нуля').max(10_000_000, 'Слишком большая сумма');
