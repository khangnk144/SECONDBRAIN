/// <reference lib="dom" />
// Settings "Kết nối Claude (MCP)" and "Cập nhật mẫu" in a real browser (SPEC F32.1, F18, owner
// request R2): the stdio snippet names the real built bridge, "Sao chép" puts exactly that text on
// the clipboard and the copied command connects as Claude Desktop would and lists the tools; the
// HTTP snippet shows the token only as ••••last4 (the copy has it whole); "Cho phép AI sửa ghi
// chú cá nhân" persists. "Cập nhật mẫu" replaces Paper.md and CLAUDE.md that are the M1 versions
// (old copies in the trash) and leaves an edited Paper.md alone. Own server per test.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test, type Page } from '@playwright/test';
import { settingsToken } from './helpers/mcp-client.js';
import { makeTempHome, ownServer, UTF8_BROWSER, type OwnServer } from './helpers/own-server.js';
import { shot, shotWide } from './helpers/screenshots.js';

test.use(UTF8_BROWSER);

const PORT = 47698;
let server: OwnServer;
let home: string;
test.beforeEach(async () => {
  // The stdio bridge finds the server through settings.json's port: seed it with this server's
  // port, so the bridge never looks at (or starts anything on) the default 4747.
  home = makeTempHome('cài đặt AI');
  mkdirSync(path.join(home, '.secondbrain'), { recursive: true });
  writeFileSync(path.join(home, '.secondbrain', 'settings.json'), JSON.stringify({ port: PORT }));
  server = ownServer(PORT, { home });
  await server.start();
});
test.afterEach(async () => {
  await server.dispose();
  rmSync(home, { recursive: true, force: true });
});

const fixtures = path.join(process.cwd(), 'server', 'test', 'templates', 'fixtures');
const PAPER_M1 = readFileSync(path.join(fixtures, 'paper-m1.md'), 'utf8');
const CLAUDE_M1 = readFileSync(path.join(fixtures, 'claude-md-m1.md'), 'utf8');

/** The snippet block whose label is `label`: its <pre> and its "Sao chép" button. */
function snippet(page: Page, label: string) {
  const field = page
    .locator('.settings-field')
    .filter({ has: page.getByText(label, { exact: true }) });
  return { code: field.locator('pre.settings-snippet'), copy: field.getByRole('button') };
}

test('MCP section: real bridge path, copy works and connects, token masked, note edits persist (F32.1)', async ({
  page,
  context,
}) => {
  test.slow();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
  const token = settingsToken(home);
  await page.goto(`${server.origin}/#/settings`);
  const section = page.getByRole('region', { name: 'Kết nối Claude (MCP)' });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('heading', { name: 'Kết nối Claude (MCP)' })).toBeVisible();

  // stdio: node + the absolute built bridge + this home (not the app folder's parent).
  const bridge = path.join(process.cwd(), 'server', 'dist', 'mcp-stdio.js');
  const stdio = snippet(page, 'Đoạn cấu hình cho Claude Desktop');
  const shown = JSON.parse((await stdio.code.textContent()) ?? '') as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  expect(shown.mcpServers['second-brain']).toEqual({
    command: expect.stringMatching(/node/),
    args: [bridge, '--home', home],
  });
  await stdio.copy.click();
  await expect(stdio.copy).toHaveText('Đã sao chép');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toEqual(shown);
  await shotWide(page, 'settings-mcp');

  // The copied command, run as Claude Desktop runs it, reaches this server and lists the tools.
  const entry = shown.mcpServers['second-brain']!;
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'claude-desktop-stand-in', version: '1.0.0' });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining(['read_source', 'ingest_begin', 'write_wiki_page']),
    );
    const result = await client.callTool({ name: 'list_notes', arguments: {} });
    expect(result.isError).not.toBe(true);
  } finally {
    await client.close();
  }

  // HTTP (collapsed): the token is masked on screen; the copy carries it whole.
  await section.getByText('Cách khác: kết nối qua HTTP').click();
  const http = snippet(page, 'Đoạn cấu hình HTTP');
  await expect(http.code).toBeVisible();
  await expect(http.code).toContainText(`Bearer ••••${token.slice(-4)}`);
  await expect(http.code).toContainText(`http://localhost:${PORT}/mcp`);
  expect(await section.textContent()).not.toContain(token);
  expect(await section.innerHTML()).not.toContain(token);
  await http.copy.click();
  await expect(http.copy).toHaveText('Đã sao chép');
  const copiedHttp = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copiedHttp.mcpServers['second-brain'].headers.Authorization).toBe(`Bearer ${token}`);
  await shot(page, 'settings-mcp-http-1280');

  // "Cho phép AI sửa ghi chú cá nhân": off by default, saved, still on after a reload.
  const edits = section.getByRole('switch', { name: 'Cho phép AI sửa ghi chú cá nhân' });
  await expect(edits).not.toBeChecked();
  await edits.click(); // controlled: it shows the saved value once the save is done
  await expect(edits).toBeChecked();
  const api = await server.api();
  await expect
    .poll(async () => (await api.get<{ mcp: { allowNoteEdits: boolean } }>('/api/settings')).mcp)
    .toEqual({ allowNoteEdits: true });
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Cho phép AI sửa ghi chú cá nhân' })).toBeChecked();
});

test('"Cập nhật mẫu" upgrades M1 Paper.md and CLAUDE.md into the trash; an edited Paper.md stays', async ({
  page,
}) => {
  const vaultFile = (p: string) => path.join(server.vaultDir, ...p.split('/'));
  const currentPaper = readFileSync(vaultFile('Templates/Paper.md'), 'utf8');
  const currentClaude = readFileSync(vaultFile('CLAUDE.md'), 'utf8');
  expect(currentPaper).toContain('## Bài toán');
  writeFileSync(vaultFile('Templates/Paper.md'), PAPER_M1);
  writeFileSync(vaultFile('CLAUDE.md'), CLAUDE_M1);
  await page.goto(`${server.origin}/#/settings`);
  await expect(
    page.getByText(/Có mẫu mới cho (Paper\.md và CLAUDE\.md|CLAUDE\.md và Paper\.md)/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cập nhật mẫu' }).click();
  await expect(
    page.getByText(
      /^Đã cập nhật (Paper\.md và CLAUDE\.md|CLAUDE\.md và Paper\.md)\. Bản cũ nằm trong thùng rác\.$/,
    ),
  ).toBeVisible();
  expect(readFileSync(vaultFile('Templates/Paper.md'), 'utf8')).toBe(currentPaper);
  expect(readFileSync(vaultFile('CLAUDE.md'), 'utf8')).toBe(currentClaude);
  const trash = path.join(server.vaultDir, '.secondbrain', 'trash');
  const entries = readdirSync(trash).map((id) => {
    const meta = JSON.parse(readFileSync(path.join(trash, id, 'meta.json'), 'utf8')) as {
      reason: string;
      originalPaths: string[];
    };
    return { id, ...meta };
  });
  const upgraded = entries.filter((e) => e.reason === 'template-upgrade');
  expect(upgraded.flatMap((e) => e.originalPaths).sort()).toEqual([
    'CLAUDE.md',
    'Templates/Paper.md',
  ]);
  // The old bytes are kept in the trash (every file there besides meta.json).
  const keptBytes = upgraded.flatMap((e) =>
    (readdirSync(path.join(trash, e.id), { recursive: true }) as string[])
      .filter((f) => !f.endsWith('meta.json'))
      .map((f) => path.join(trash, e.id, f))
      .filter((f) => statSync(f).isFile())
      .map((f) => readFileSync(f, 'utf8')),
  );
  expect(keptBytes.sort()).toEqual([CLAUDE_M1, PAPER_M1].sort());
  await shot(page, 'settings-templates-upgraded-1280');

  // An edited Paper.md: named, never replaced; nothing to upgrade, so no button.
  const edited = `${PAPER_M1}\nGhi chú của tôi.\n`;
  writeFileSync(vaultFile('Templates/Paper.md'), edited);
  await page.reload();
  await expect(page.getByText('Bạn đã sửa Paper.md nên app không thay nó.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cập nhật mẫu' })).toHaveCount(0);
  expect(readFileSync(vaultFile('Templates/Paper.md'), 'utf8')).toBe(edited);
});
