// Data-backed answers without an LLM (offline mode, budget exhausted, provider error).
// Every sentence is rendered from tool results; nothing is invented.
import type { Route } from './router.ts';
import type { AssistantAction, StudioContext, ToolName } from './types.ts';

// Browsers render some currencies as ISO codes ("400 KGS"); show the word people use instead.
const LOCAL_SIGN: Record<string, string> = { KGS: 'сом', UZS: 'сум', TJS: 'сомони', KZT: '₸', RUB: '₽', BYN: 'руб.' };
export function money(amount: number, currency = 'RUB'): string {
  const sign = LOCAL_SIGN[currency];
  if (sign) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount)} ${sign}`;
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

const STATUS_RU: Record<string, string> = {
  confirmed: 'ожидается',
  arrived: 'пришла',
  done: 'готово',
  cancelled: 'отменена',
  no_show: 'не пришла',
};

type Results = Partial<Record<ToolName, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function formatOffline(route: Route, results: Results, ctx: StudioContext, scope: 'client' | 'owner'): { text: string; actions: AssistantAction[] } {
  const actions: AssistantAction[] = [];
  const base = `/s/${ctx.slug}`;
  switch (route.intent) {
    case 'slots': {
      if (route.clarify === 'service' || !results.find_slots) {
        const list = (results.list_services?.services ?? ctx.services).slice(0, 6) as StudioContext['services'];
        for (const s of list.slice(0, 3)) actions.push({ label: s.name, href: `${base}/book?service=${s.id}` });
        return {
          text: `Подскажу ближайшее время — уточните, на какую процедуру? Например: ${list.map((s) => s.name).join(', ')}.`,
          actions,
        };
      }
      const r = results.find_slots;
      if (r.error) return { text: 'Не нашла такую услугу. Выберите процедуру из списка услуг, и я покажу свободное время.', actions };
      const withTimes = (r.days as { label: string; times: string[]; starts: string[] }[]).filter((d) => d.times.length);
      if (!withTimes.length) {
        return { text: `На «${r.service.name}» в выбранные дни свободных окон нет. Посмотрите другие даты в записи.`, actions: [{ label: 'Открыть запись', href: r.booking_url }] };
      }
      const first = withTimes[0]!;
      for (let i = 0; i < Math.min(3, first.starts.length); i++) {
        actions.push({ label: `${first.label}, ${first.times[i]}`, href: `${r.booking_url}&start=${encodeURIComponent(first.starts[i]!)}` });
      }
      const lines = withTimes.slice(0, 3).map((d) => `${d.label}: ${d.times.slice(0, 6).join(', ')}${d.times.length > 6 ? '…' : ''}`);
      return { text: `Свободное время на «${r.service.name}» (${money(r.service.price, ctx.currency)}, ${r.service.duration_min} мин):\n${lines.join('\n')}`, actions };
    }
    case 'prices': {
      const list = (results.list_services?.services ?? []) as { id: string; name: string; price: number; price_is_from: boolean; duration_min: number }[];
      if (!list.length) return { text: 'В прайсе пока нет услуг.', actions };
      for (const s of list.slice(0, 2)) actions.push({ label: `Записаться: ${s.name}`, href: `${base}/book?service=${s.id}` });
      const lines = list.slice(0, 8).map((s) => `• ${s.name} — ${s.price_is_from ? 'от ' : ''}${money(s.price, ctx.currency)}, ${s.duration_min} мин`);
      return { text: `${list.length > 8 ? 'Основные цены' : 'Цены'}:\n${lines.join('\n')}`, actions };
    }
    case 'location': {
      const i = results.studio_info;
      if (i.map_url) actions.push({ label: 'Открыть на карте', href: i.map_url });
      return { text: `Мы находимся по адресу: ${i.address}.${i.address_note ? ` ${i.address_note}.` : ''}${i.phone ? ` Телефон: ${i.phone}.` : ''}`, actions };
    }
    case 'hours': {
      const i = results.studio_info;
      const lines = (i.hours as { day: string; hours: string | null }[]).map((h) => `${h.day}: ${h.hours ?? 'выходной'}`);
      return { text: `Часы работы:\n${lines.join('\n')}`, actions };
    }
    case 'contacts': {
      const i = results.studio_info;
      if (i.phone) actions.push({ label: 'Позвонить', href: `tel:${String(i.phone).replace(/[^\d+]/g, '')}` });
      if (i.telegram) actions.push({ label: 'Telegram', href: `https://t.me/${i.telegram}` });
      return { text: `Связаться со студией: ${[i.phone, i.whatsapp && `WhatsApp ${i.whatsapp}`, i.telegram && `Telegram @${i.telegram}`].filter(Boolean).join(', ')}.`, actions };
    }
    case 'masters': {
      const m = (results.list_masters?.masters ?? []) as { name: string; role_title: string; experience_years: number | null }[];
      return { text: m.map((x) => `• ${x.name} — ${x.role_title}${x.experience_years ? `, опыт ${x.experience_years} лет` : ''}`).join('\n') || 'Список мастеров пока пуст.', actions };
    }
    case 'schedule': {
      const r = results.owner_schedule;
      const list = (r.bookings as { date_label: string; time: string; client: string; service: string; master: string; status: string }[]).filter(
        (b) => b.status !== 'cancelled',
      );
      if (!list.length) return { text: `На ${r.period.label} записей нет.`, actions };
      const lines = list.slice(0, 15).map((b) => `• ${b.date_label} ${b.time} — ${b.client}, ${b.service} (${b.master}), ${STATUS_RU[b.status] ?? b.status}`);
      return { text: `${capital(r.period.label)}: ${list.length} ${plural(list.length, 'запись', 'записи', 'записей')}.\n${lines.join('\n')}${list.length > 15 ? '\n…' : ''}`, actions };
    }
    case 'stats':
    case 'revenue': {
      const s = results.owner_stats;
      const cur = ctx.currency;
      const head = `${capital(s.period.label)} (${s.period.from} — ${s.period.to}):`;
      const text =
        route.intent === 'revenue'
          ? `${head} получено ${money(s.received, cur)} (оплаты ${money(s.payments_total, cur)}, возвраты ${money(s.refunds_total, cur)}). По будущим записям ожидается ${money(s.expected, cur)} — это ещё не выручка.`
          : `${head} визитов ${s.visits}, выполнено ${s.completed}, всего записей ${s.booked}, отмен ${s.cancelled}, неявок ${s.no_show}. Получено ${money(s.received, cur)}.`;
      return { text, actions };
    }
    case 'greeting':
      return {
        text:
          scope === 'owner'
            ? 'Здравствуйте! Спросите про записи на сегодня или завтра, визиты за неделю или полученные деньги.'
            : `Здравствуйте! Я помощник ${ctx.name}. Подскажу цены, свободное время и как нас найти.`,
        actions,
      };
    default:
      return {
        text:
          scope === 'owner'
            ? 'Я отвечаю по данным студии: «Что у меня завтра?», «Сколько визитов на неделе?», «Сколько денег получено за месяц?».'
            : 'Я могу подсказать цены, ближайшее свободное время и как добраться. Например: «Когда ближайшее окно?»',
        actions,
      };
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
