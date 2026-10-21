/// <reference lib="dom" />
// Scenario S2 with reminders, minus the real Windows toast (SPEC §2, F17): a course project with
// a deadline 3 days ahead; the reminder time is set to the current minute in Settings, the
// server's scheduler fires at its next tick, the "Nhắc nhở" screen lists the reminder, the
// sidebar counts it, one Web Notification is shown (the server toast is `unsupported` here), and
// "Bỏ qua" removes it. Own server: the reminder time is a global setting.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { isoAddDays, localIso } from './helpers/app-api.js';
import { appReady } from './helpers/keyboard.js';
import { noteBody, noteTitle } from './helpers/note-page.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';
import { shot } from './helpers/screenshots.js';

// Full Chromium (new headless mode): the headless shell answers `Notification.permission ===
// 'denied'` even after the permission was granted, so no page could ever show a notification.
test.use({ channel: 'chromium' });

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47691);
  await server.start();
});
test.afterEach(async () => server.dispose());

interface SpiedNotification {
  title: string;
  body: string;
  tag: string;
}
interface ReminderList {
  available: boolean;
  time: string;
  toastSupported: boolean;
  reminders: { key: string; title: string; threshold: number; toast: string; due: string }[];
}

const pad = (n: number) => String(n).padStart(2, '0');

test('S2: a deadline 3 days ahead is reminded at the set time, listed, counted, notified once and dismissed (F17)', async ({
  page,
  context,
}) => {
  // Waits for the scheduler's 60 s tick.
  test.setTimeout(180_000);
  const now = new Date();
  test.skip(
    now.getHours() === 23 && now.getMinutes() >= 57,
    'the reminder minute would cross midnight',
  );
  await context.grantPermissions(['notifications'], { origin: server.origin });
  // Records every Web Notification the page creates (the real permission is kept).
  await page.addInitScript(() => {
    const Real = window.Notification;
    const created: SpiedNotification[] = [];
    (window as unknown as { __notifications: SpiedNotification[] }).__notifications = created;
    class Spy {
      static get permission() {
        return Real.permission;
      }
      static requestPermission() {
        return Real.requestPermission();
      }
      onclick: (() => void) | null = null;
      constructor(title: string, options: NotificationOptions = {}) {
        created.push({ title, body: options.body ?? '', tag: options.tag ?? '' });
      }
      close() {}
    }
    window.Notification = Spy as unknown as typeof Notification;
  });
  const notifications = () =>
    page.evaluate(
      () => (window as unknown as { __notifications: SpiedNotification[] }).__notifications,
    );

  // The course project from its template, deadline set in the property bar.
  const title = 'Đồ án Xác suất nhắc';
  const deadline = isoAddDays(localIso(), 3);
  await page.goto(`${server.origin}/`);
  await appReady(page);
  await page.keyboard.press('Alt+n');
  await page
    .getByRole('listbox')
    .getByRole('option', { name: /Course project/ })
    .click();
  await expect(noteTitle(page)).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(noteBody(page)).toBeFocused();
  await page.locator('.property-chip[data-key="deadline"] .property-chip__main').click();
  const dateInput = page.getByRole('dialog', { name: 'Sửa Hạn chót' }).getByLabel('Hạn chót');
  await dateInput.fill(deadline);
  await dateInput.press('Enter');
  const notePath = `0 Inbox/${title}.md`;
  await expect
    .poll(() => readFileSync(path.join(server.vaultDir, ...notePath.split('/')), 'utf8'))
    .toContain(`\ndeadline: ${deadline}\n`);

  // Settings: the reminder time becomes the current minute.
  await page.keyboard.press('Alt+,');
  const timeField = page.getByLabel('Giờ nhắc');
  await expect(timeField).toHaveValue('08:00');
  const minute = new Date();
  const time = `${pad(minute.getHours())}:${pad(minute.getMinutes())}`;
  await timeField.fill(time);
  await timeField.press('Enter');
  await expect(page.locator('#settings-reminder-time-status')).toHaveText('Đã lưu');
  const api = await server.api();
  expect((await api.get<{ reminders: { time: string } }>('/api/settings')).reminders.time).toBe(
    time,
  );

  // The reminders screen, open while the server's next tick fires.
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await nav.getByRole('link', { name: 'Nhắc nhở', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nhắc nhở' })).toBeVisible();
  await expect(page.getByText(`Mình nhắc bạn lúc ${time}.`)).toBeVisible();
  const list = page.getByRole('list', { name: 'Danh sách nhắc nhở' });
  const row = list.locator('.reminder-row').filter({ hasText: title });
  await expect(row).toHaveCount(1, { timeout: 90_000 });
  await expect(row).toContainText('Còn 3 ngày');
  const counted = nav.getByRole('link', { name: 'Nhắc nhở, 1 nhắc nhở' });
  await expect(counted).toBeVisible();
  await expect(counted.locator('.sidebar-nav__badge')).toHaveText('1');
  await shot(page, 'reminders-list');

  const listed = await api.get<ReminderList>('/api/reminders');
  expect(listed).toMatchObject({ available: true, time, toastSupported: false });
  expect(listed.reminders).toHaveLength(1);
  const reminder = listed.reminders[0]!;
  expect(reminder).toMatchObject({ threshold: 3, due: deadline, toast: 'unsupported' });

  // One Web Notification for it (the toast was not shown), tagged with its key.
  await expect.poll(async () => (await notifications()).length).toBe(1);
  await page.waitForTimeout(1_000);
  const [shown] = await notifications();
  expect(await notifications()).toHaveLength(1);
  expect(shown!.title).toBe(`Nhắc nhở: ${reminder.title}`);
  expect(shown!.title).toContain(title);
  expect(shown!.tag).toBe(reminder.key);

  // "Bỏ qua" removes it from the list, the badge and the server's list; the store keeps it.
  await row.getByRole('button', { name: `Bỏ qua nhắc nhở “${reminder.title}”` }).click();
  await expect(row).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Nhắc nhở', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar-nav__badge')).toHaveCount(0);
  expect((await api.get<ReminderList>('/api/reminders')).reminders).toHaveLength(0);
  const store = JSON.parse(
    readFileSync(path.join(server.vaultDir, '.secondbrain', 'state', 'reminders.json'), 'utf8'),
  ) as { entries: { key: string; dismissed?: boolean }[] };
  expect(store.entries.find((e) => e.key === reminder.key)?.dismissed).toBe(true);
});
