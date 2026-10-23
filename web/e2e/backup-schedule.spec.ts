/// <reference lib="dom" />
// Scheduled backups (F27.1–F27.5) in a real browser, Bento style, own server: Settings → Kho ghi
// chú → "Sao lưu tự động" defaults; a folder inside the vault is refused in words; "Sao lưu ngay"
// into a folder with spaces and Vietnamese letters writes "Second Brain vault <date time>.zip"
// (the export's content, recorded in backups.json) and the status lines; retention keeps the
// newest N of the app's own zips and never touches her files or a renamed copy; the daily
// schedule at the next minute writes one more; the GitHub block waits for address and token and
// never shows the token (…last4 only).
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { createNote } from './helpers/m5-app.js';
import { ownServer, type OwnServer } from './helpers/own-server.js';

let server: OwnServer;
test.beforeEach(async () => {
  server = ownServer(47696, { style: 'bento' });
  await server.start();
  await createNote(await server.api(), '1 Projects/Đồ án sao lưu.md', '# Đồ án sao lưu\n');
});
test.afterEach(async () => server.dispose());

const NAME = /^Second Brain vault \d{4}-\d{2}-\d{2} \d{4}( \(\d+\))?\.zip$/;
const appZips = (dir: string) =>
  readdirSync(dir)
    .filter((name) => NAME.test(name))
    .sort();
const section = (page: Page) => page.getByRole('group', { name: 'Sao lưu tự động' });

interface ScheduleStatus {
  lastSuccess: { fileName: string; at: string } | null;
}

async function saveField(page: Page, label: string, value: string): Promise<void> {
  const field = section(page).getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press('Enter');
}

test('defaults, refusal, run now, status, retention keeps her files (F27.1, F27.3, F27.4)', async ({
  page,
}) => {
  test.slow();
  const api = await server.api();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/#/settings`);
  const backup = section(page);
  await backup.scrollIntoViewIfNeeded();
  await expect(backup.getByRole('switch', { name: 'Sao lưu tự động hằng ngày' })).not.toBeChecked();
  await expect(backup.getByLabel('Giờ sao lưu', { exact: true })).toHaveValue('21:00');
  await expect(backup.getByLabel('Giữ lại bao nhiêu bản', { exact: true })).toHaveValue('14');
  const defaultFolder = path.join(server.home, 'Backups');
  await expect(backup.getByText(`Để trống để dùng ${defaultFolder}.`)).toBeVisible();
  await expect(backup.getByText('Chưa có bản sao lưu tự động nào.')).toBeVisible();

  // A folder inside the vault would back itself up: said at once, and the run is refused.
  await saveField(page, 'Thư mục sao lưu', path.join(server.vaultDir, 'Sao lưu'));
  await expect(
    backup
      .getByText(
        'Thư mục này nằm trong kho ghi chú nên không dùng được. Chọn thư mục bên ngoài kho.',
      )
      .first(),
  ).toBeVisible();
  await backup.getByRole('button', { name: 'Sao lưu ngay' }).click();
  await expect(backup.getByText(/Chọn thư mục bên ngoài kho\./)).not.toHaveCount(0);

  // Her folder (spaces, Vietnamese letters) already holds her own files.
  const folder = path.join(server.home, 'Sao lưu của tôi');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'ghi chú riêng.txt'), 'của tôi\n');
  writeFileSync(path.join(folder, 'Second Brain vault 2020-01-01 0000.zip'), 'không phải của app');
  await saveField(page, 'Thư mục sao lưu', folder);
  await saveField(page, 'Giữ lại bao nhiêu bản', '3');
  await expect
    .poll(
      async () =>
        (await api.get<{ backup: { schedule: { folder: string; keep: number } } }>('/api/settings'))
          .backup.schedule,
    )
    .toMatchObject({ folder, keep: 3 });

  // "Sao lưu ngay": the zip appears, named after the vault folder and the local time.
  await backup.getByRole('button', { name: 'Sao lưu ngay' }).click();
  await expect(backup.getByText(/^Đã lưu Second Brain vault .+\.zip\.$/)).toBeVisible({
    timeout: 20_000,
  });
  const first = appZips(folder).filter((n) => !n.startsWith('Second Brain vault 2020'));
  expect(first).toHaveLength(1);
  const entries = Object.keys(unzipSync(readFileSync(path.join(folder, first[0]!))));
  expect(entries.some((name) => name.endsWith('1 Projects/Đồ án sao lưu.md'))).toBe(true);
  expect(entries.some((name) => /settings\.json$/.test(name) && !name.includes('vault'))).toBe(
    false,
  );
  await expect(
    backup.getByText(new RegExp(`^Lần cuối: .+, .+, ${first[0]!.replace(/[()]/g, '\\$&')}$`)),
  ).toBeVisible();
  const records = JSON.parse(
    readFileSync(path.join(server.home, '.secondbrain', 'backups.json'), 'utf8'),
  ) as { vaults: Record<string, { runs: { fileName?: string }[] }> };
  expect(JSON.stringify(records)).toContain(first[0]!);

  // She keeps a renamed copy; three more runs; only the app's oldest zip goes (keep = 3).
  copyFileSync(path.join(folder, first[0]!), path.join(folder, 'bản của tôi.zip'));
  for (let i = 0; i < 3; i += 1) {
    const last = (await api.get<ScheduleStatus>('/api/backup/schedule')).lastSuccess?.at;
    await backup.getByRole('button', { name: 'Sao lưu ngay' }).click();
    await expect
      .poll(async () => (await api.get<ScheduleStatus>('/api/backup/schedule')).lastSuccess?.at, {
        timeout: 20_000,
      })
      .not.toBe(last);
  }
  await expect
    .poll(() => appZips(folder).filter((n) => !n.startsWith('Second Brain vault 2020')).length)
    .toBe(3);
  const left = readdirSync(folder);
  expect(left).not.toContain(first[0]);
  expect(left).toEqual(
    expect.arrayContaining([
      'ghi chú riêng.txt',
      'Second Brain vault 2020-01-01 0000.zip',
      'bản của tôi.zip',
    ]),
  );
});

test('the daily schedule at the next minute writes one backup (F27.1, F27.2)', async ({ page }) => {
  // Waits for the scheduler's 60 s check.
  test.setTimeout(240_000);
  const now = new Date();
  test.skip(
    now.getHours() === 23 && now.getMinutes() >= 57,
    'the backup minute would cross midnight',
  );
  const api = await server.api();
  const folder = path.join(server.home, 'Sao lưu hằng ngày');
  mkdirSync(folder, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/#/settings`);
  const at = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  await saveField(page, 'Thư mục sao lưu', folder);
  await saveField(page, 'Giờ sao lưu', time);
  // The switch flips once the server saved it (no optimistic state).
  const enable = section(page).getByRole('switch', { name: 'Sao lưu tự động hằng ngày' });
  await enable.click();
  await expect(enable).toBeChecked();
  await expect
    .poll(
      async () =>
        (
          await api.get<{ backup: { schedule: { enabled: boolean; time: string } } }>(
            '/api/settings',
          )
        ).backup.schedule,
    )
    .toMatchObject({ enabled: true, time });
  await expect.poll(() => appZips(folder).length, { timeout: 180_000, intervals: [2_000] }).toBe(1);
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time.replace(':', '')}`;
  expect(appZips(folder)[0]).toBe(`Second Brain vault ${stamp}.zip`);
  // The open Settings screen shows the run without a reload (E2E D3: it kept "Chưa có…" and a
  // past "Lần tới" until opened again).
  await expect(section(page).getByText(/^Lần cuối: /)).toBeVisible({ timeout: 20_000 });
  await expect(section(page).getByText('Chưa có bản sao lưu tự động nào.')).toHaveCount(0);
  // One run for that slot: a later check does not repeat it.
  await page.waitForTimeout(65_000);
  expect(appZips(folder)).toHaveLength(1);
});

test('GitHub push: waits for address and token; the token is masked and never in the page (F27.5)', async ({
  page,
}) => {
  const api = await server.api();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${server.origin}/#/settings`);
  const github = page.getByRole('group', { name: 'Đẩy lên GitHub' });
  await github.scrollIntoViewIfNeeded();
  const toggle = github.getByRole('switch', { name: 'Đẩy lên GitHub sau mỗi lần sao lưu tự động' });
  await expect(toggle).toBeDisabled();
  await expect(github.getByText('Điền địa chỉ kho và khóa truy cập trước để bật.')).toBeVisible();
  await expect(github.getByRole('button', { name: 'Đẩy ngay' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // Only https, never credentials in the address.
  const remote = github.getByLabel('Địa chỉ kho GitHub', { exact: true });
  await remote.fill('https://ban:mat-khau@github.com/ban/kho.git');
  await remote.press('Enter');
  await expect(
    github.getByText('Đừng để tên đăng nhập hay khóa trong địa chỉ. Dán khóa vào ô Khóa truy cập.'),
  ).toBeVisible();
  await remote.fill('https://github.com/ban/second-brain.git');
  await remote.press('Enter');
  const token = 'github_pat_11AAAAAAA0e2eSecretTokenValueZ9q7';
  const field = github.getByLabel('Khóa truy cập GitHub', { exact: true });
  await field.fill(token);
  await field.press('Enter');
  await expect(github.getByText(`Đã lưu, kết thúc bằng …${token.slice(-4)}.`)).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(toggle).toBeEnabled();
  const settings = JSON.stringify(await api.get('/api/settings'));
  expect(settings).not.toContain(token);
  expect(settings).toContain(token.slice(-4));
  await page.reload();
  await expect(github.getByText(`Đã lưu, kết thúc bằng …${token.slice(-4)}.`)).toBeVisible();
  expect(await page.content()).not.toContain(token);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(token);
  // Removing it disables the switch again.
  await github.getByRole('button', { name: 'Xóa khóa GitHub' }).click();
  await expect(github.getByText('Chưa lưu.')).toBeVisible();
  await expect(toggle).toBeDisabled();
});
