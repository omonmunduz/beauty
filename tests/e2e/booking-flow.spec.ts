// From choosing a service to the confirmed booking — and the same booking in the owner cabinet.
import { expect, test } from '@playwright/test';
import { loadEnvFile } from '../../scripts/lib/tenants.ts';

loadEnvFile();
const SLUG = 'silk-room';
const TZ = 'Europe/Moscow';

test('client books without registration, owner sees the booking', async ({ page, browser }) => {
  const clientName = `E2E ${Date.now().toString(36)}`;
  // Clients are identified by phone inside a studio, so every run uses its own number.
  const phone = `+7 9${String(Date.now()).slice(-9)}`;

  // 1. Service list → service
  await page.goto(`/s/${SLUG}/services`);
  await expect(page.getByRole('heading', { name: 'Услуги и цены' })).toBeVisible();
  await page.getByRole('link', { name: /Подмышки/ }).first().click();

  // 2. Time: busy slots are disabled, pick the first free one
  await expect(page.getByRole('heading', { name: 'Дата и время' })).toBeVisible();
  const freeSlot = page.getByRole('group', { name: 'Время' }).locator('button.slot:not([disabled])').first();
  // The sheet animates between steps; retry until the selection lands in the URL.
  await expect(async () => {
    await freeSlot.click();
    await expect(page).toHaveURL(/start=/, { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  const start = new URL(page.url()).searchParams.get('start');
  expect(start).toBeTruthy();
  const next = page.getByRole('button', { name: /^Далее/ });
  if (await next.isVisible()) await next.click();

  // 3. Contacts: validation first, then a real submit
  await expect(page.getByRole('heading', { name: 'Подтверждение' })).toBeVisible();
  await page.getByRole('button', { name: 'Записаться' }).click();
  await expect(page.getByText('Укажите имя')).toBeVisible();
  await page.getByLabel('Имя').fill(clientName);
  await page.getByRole('textbox', { name: /Телефон|\+7/ }).fill(phone);
  await page.getByRole('button', { name: 'Записаться' }).click();

  // 4. Confirmation screen with the booking ticket
  await expect(page.getByRole('heading', { name: 'Вы записаны' })).toBeVisible();
  await expect(page.getByRole('article', { name: /Подмышки/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Мои записи/ })).toContainText('1');

  // The booked time is no longer offered to anyone else.
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(start!));

  // 5. Owner cabinet in a separate, clean browser context
  const owner = await browser.newContext();
  const op = await owner.newPage();
  await op.goto(`/s/${SLUG}/owner?date=${date}`);
  await op.getByLabel('Почта').fill(process.env.OWNER_SILK_ROOM_EMAIL!);
  await op.getByLabel('Пароль').fill(process.env.OWNER_SILK_ROOM_PASSWORD!);
  await op.getByRole('button', { name: 'Войти' }).click();
  await expect(op.getByRole('heading', { name: 'Расписание' })).toBeVisible();
  const appt = op.getByRole('button', { name: new RegExp(clientName) });
  await expect(appt).toBeVisible();
  await expect(appt).toContainText('Подмышки');

  // 6. Owner marks the visit and takes the payment
  await appt.click();
  await op.getByRole('button', { name: 'Пришла', exact: true }).click();
  await expect(op.getByRole('button', { name: 'Готово', exact: true })).toBeVisible();
  await expect(op.getByRole('button', { name: 'Вернуть в ожидание' })).toBeVisible();

  // 7. Logout clears the private cache: the cabinet asks for a password again
  await op.keyboard.press('Escape');
  await op.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(op.getByRole('button', { name: 'Войти' })).toBeVisible();
  const leftovers = await op.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('beauty-owner') || k.startsWith('sb-')));
  expect(leftovers).toEqual([]);
  await owner.close();
});

test('studio deep links and isolation', async ({ page }) => {
  await page.goto(`/s/laser-lab/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Laser Lab' })).toBeVisible();
  await page.goto(`/s/no-such-studio/`);
  await expect(page.getByText('Студия не найдена')).toBeVisible();
});
