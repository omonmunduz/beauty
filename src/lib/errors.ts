// Server error codes (raised by SQL functions) -> human messages.
const MESSAGES: Record<string, string> = {
  slot_taken: 'Это время только что заняли. Выберите другое — список обновлён.',
  slot_invalid: 'На это время записаться нельзя. Выберите другое окно.',
  service_not_found: 'Услуга больше недоступна.',
  resource_not_found: 'Мастер недоступен.',
  tenant_not_found: 'Студия не найдена.',
  booking_not_found: 'Запись не найдена или ссылка устарела.',
  invalid_name: 'Укажите имя.',
  invalid_phone: 'Проверьте номер телефона.',
  invalid_notes: 'Комментарий слишком длинный.',
  idempotency_conflict: 'Данные изменились — подтвердите запись ещё раз.',
  rate_limited: 'Слишком много попыток. Подождите минуту и повторите.',
  cancel_window_closed: 'Отменить онлайн уже нельзя — позвоните в студию.',
  cannot_cancel_status: 'Эту запись нельзя отменить.',
  cannot_reschedule_status: 'Перенести можно только подтверждённую запись.',
  invalid_transition: 'Такой смены статуса нет.',
  refund_exceeds_paid: 'Возврат больше внесённой оплаты.',
  invalid_amount: 'Проверьте сумму.',
  invalid_range: 'Проверьте период.',
  forbidden: 'Нет доступа к этой студии.',
  block_not_found: 'Блокировка уже снята.',
  not_ready: 'Студия ещё не готова к запуску.',
};

export class AppError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? MESSAGES[code] ?? 'Что-то пошло не так. Попробуйте ещё раз.');
    this.code = code;
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const raw = (e as { message?: string })?.message ?? '';
  const code = raw.split(':')[0]!.trim();
  if (MESSAGES[code]) return new AppError(code);
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return new AppError('network', 'Нет соединения. Проверьте интернет и повторите.');
  if (/Invalid login credentials/i.test(raw)) return new AppError('auth', 'Неверная почта или пароль.');
  return new AppError('unknown');
}

export function errorText(e: unknown): string {
  return toAppError(e).message;
}
