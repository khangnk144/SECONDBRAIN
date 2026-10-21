/// <reference lib="dom" />
// Scenario S4 scripted (SPEC §2, F32.1, F32.3, F34): with the sample data and the brain map open,
// an MCP client over Streamable HTTP (bearer token from the settings file) runs the documented
// ingest of a sample PDF: list_sources → ingest_begin → read_source → write_wiki_page (the paper
// page in the M6 format, a new concept page) → wiki_index_update → ingest_complete. The map's side
// panel lists "AI vừa cập nhật" with the pages in the AI's order, the new node is on the map, the
// paper page opens from the list with the AI banner, wiki/log.md gains exactly one line, and a
// second ingest_begin of the same content is refused. /mcp refuses a missing token and a foreign
// Origin. Own server: the sample set and the ingest manifest are per-vault state.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { localIso } from './helpers/app-api.js';
import { connectMcp, settingsToken, type ScriptedMcpClient } from './helpers/mcp-client.js';
import { noteBody } from './helpers/note-page.js';
import { ownServer, UTF8_BROWSER, type OwnServer } from './helpers/own-server.js';
import { shotWide } from './helpers/screenshots.js';

test.use(UTF8_BROWSER);

let server: OwnServer;
let mcp: ScriptedMcpClient | null = null;
test.beforeEach(async () => {
  server = ownServer(47698);
  await server.start();
});
test.afterEach(async () => {
  await mcp?.close();
  mcp = null;
  await server.dispose();
});

const PDF = '3 Resources/papers/dropout-prediction-sequence-models.pdf';
const PAPER = 'wiki/papers/dropout-prediction-sequence-models.md';
const CONCEPT = 'wiki/concepts/Dự đoán bỏ học.md';
const INDEX = 'wiki/index.md';
const SPEC_TOOLS = [
  'search_notes',
  'read_note',
  'list_notes',
  'get_backlinks',
  'get_upcoming_deadlines',
  'get_today',
  'graph_neighbors',
  'capture_to_inbox',
  'append_to_daily',
  'write_wiki_page',
  'read_source',
  'list_sources',
  'ingest_begin',
  'ingest_complete',
  'ingest_fail',
  'wiki_index_update',
  'wiki_log_append',
  'wiki_lint',
  'write_note',
];

const onDisk = (vaultPath: string) =>
  readFileSync(path.join(server.vaultDir, ...vaultPath.split('/')), 'utf8');

function paperPage(hash: string, today: string): string {
  return [
    '---',
    'type: wiki',
    'authors: [Hoa Le, David Kim]',
    'year:',
    'venue:',
    'datasets: [ba khóa học trực tuyến]',
    `source: ${PDF}`,
    `source_hash: ${hash}`,
    'pages_covered: 1-1',
    'verified: false',
    `ingested_at: ${today}`,
    '---',
    '',
    '# Dự đoán bỏ học từ hoạt động hằng tuần',
    '',
    '## Tóm tắt',
    '',
    'Mô hình chuỗi dự đoán sinh viên bỏ khóa học trực tuyến từ số lần đăng nhập, thời gian xem video và số lần làm quiz mỗi tuần (tr. 1).',
    '',
    '## Bài toán',
    '',
    'Biết sớm sinh viên nào sắp bỏ khóa học.',
    '',
    '**Input:** số lần hoạt động hằng tuần của mỗi sinh viên (tr. 1).',
    '',
    '**Output:** khả năng sinh viên đó bỏ học (tr. 1).',
    '',
    '## Các cách hiện có',
    '',
    'Hồi quy logistic trên cùng dữ liệu (tr. 1).',
    '',
    '## Khoảng trống và động lực',
    '',
    'Bài báo không nói rõ.',
    '',
    '## Phương pháp',
    '',
    'Mô hình chuỗi hồi quy (recurrent) đọc hoạt động theo từng tuần (tr. 1).',
    '',
    '## Dữ liệu',
    '',
    'Ba khóa học trực tuyến; kích thước không nói rõ (tr. 1).',
    '',
    '## Thí nghiệm',
    '',
    'So sánh với hồi quy logistic, thước đo AUC (tr. 1).',
    '',
    '## Kết quả (theo tác giả)',
    '',
    'AUC 0,86 ở tuần thứ tư, so với 0,78 của hồi quy logistic (tr. 1).',
    '',
    '## Hạn chế và hướng tiếp theo',
    '',
    'Chỉ có khóa học trực tuyến; chưa biết với sinh viên học trên lớp (tr. 1).',
    '',
    '## Nhận xét của AI',
    '',
    'Kết quả hứa hẹn nhưng chưa kiểm chứng ngoài môi trường trực tuyến.',
    '',
    '## Liên quan',
    '',
    `- [[${CONCEPT.slice(0, -3)}]]`,
    '',
  ].join('\n');
}

const conceptPage = [
  '---',
  'type: wiki',
  '---',
  '',
  '# Dự đoán bỏ học',
  '',
  'Đoán trước sinh viên nào có thể bỏ khóa học, từ dữ liệu hoạt động.',
  '',
  `- [[${PAPER.slice(0, -3)}]] (tr. 1): mô hình chuỗi đạt AUC 0,86 ở tuần thứ tư.`,
  '',
].join('\n');

test('S4: a scripted MCP ingest lights the map, lists the pages in order, logs one line (F32.3, F34.1)', async ({
  page,
}) => {
  test.slow();
  const api = await server.api();
  await api.send('POST', '/api/sample-data');
  mcp = await connectMcp(server.origin, settingsToken(server.home));
  expect(await mcp.listTools()).toEqual(expect.arrayContaining(SPEC_TOOLS));

  // The sample PDF's text is extracted in the background (2 s debounce).
  let source:
    | { sourceId: string; status: string; contentHash: string; extractionQuality: string }
    | undefined;
  await expect
    .poll(
      async () => {
        const listed = await mcp!.call('list_sources');
        source = listed.data.sources.find((s: { path: string }) => s.path === PDF);
        return source?.extractionQuality;
      },
      { timeout: 30_000 },
    )
    .toBe('ok');
  expect(source!.status).toBe('new');

  // The map is open before the ingest starts.
  await page.goto(`${server.origin}/#/graph`);
  await expect(page.locator('.graph-legend')).toBeVisible({ timeout: 15_000 });
  const graphBefore = await api.get<{ nodes: { id: string }[] }>('/api/graph');
  expect(graphBefore.nodes.map((n) => n.id)).not.toContain(CONCEPT);
  const logBefore = onDisk('wiki/log.md');

  const begun = await mcp.call('ingest_begin', { sourceId: source!.sourceId });
  expect(begun.isError, JSON.stringify(begun.data)).toBe(false);
  const read = await mcp.call('read_source', { path: PDF });
  expect(read.data).toMatchObject({ extractionQuality: 'ok', pageCount: 1, nextPage: null });
  expect(read.data.chunks[0].text).toContain('AUC of 0.86');

  const paperNow = await mcp.call('read_note', { path: PAPER });
  const wrotePaper = await mcp.call('write_wiki_page', {
    path: PAPER,
    content: paperPage(read.data.contentHash, localIso()),
    expectedRevision: paperNow.data.revision,
  });
  expect(wrotePaper.isError, JSON.stringify(wrotePaper.data)).toBe(false);
  const wroteConcept = await mcp.call('write_wiki_page', { path: CONCEPT, content: conceptPage });
  expect(wroteConcept.data).toMatchObject({ path: CONCEPT, created: true });
  const index = await mcp.call('read_note', { path: INDEX });
  const updated = await mcp.call('wiki_index_update', {
    content: `${index.data.content.trimEnd()}\n- [[${CONCEPT.slice(0, -3)}]] — dự đoán bỏ học\n`,
    expectedRevision: index.data.revision,
  });
  expect(updated.isError, JSON.stringify(updated.data)).toBe(false);
  const done = await mcp.call('ingest_complete', {
    runId: begun.data.runId,
    outputs: [PAPER, CONCEPT, INDEX],
  });
  expect(done.data).toMatchObject({ status: 'succeeded' });

  // The side panel: "Từ <source>" and the three pages in the AI's order; the live region says it.
  const touched = page.getByRole('region', { name: 'AI vừa cập nhật' });
  await expect(touched).toBeVisible({ timeout: 5_000 });
  await expect(touched.locator('.graph-touch__source button')).toHaveAttribute('title', PDF);
  const pages = touched.locator('.graph-touch__pages button');
  await expect(pages).toHaveCount(3);
  expect(await pages.evaluateAll((list) => list.map((b) => b.getAttribute('title')))).toEqual([
    PAPER,
    CONCEPT,
    INDEX,
  ]);
  await expect(page.locator('.graph-panel [aria-live="polite"]')).toContainText(
    'AI vừa cập nhật 3 trang từ',
  );
  await page.waitForTimeout(1_500); // entry 600 ms + travel 300 ms + 150 ms per page: all lit
  await shotWide(page, 'mcp-graph-ai-touch');

  // The new concept page is a node of the map (refetched without a reload).
  const graphAfter = await api.get<{ nodes: { id: string }[] }>('/api/graph');
  expect(graphAfter.nodes.map((n) => n.id)).toContain(CONCEPT);
  const search = page.getByRole('combobox', { name: 'Tìm ghi chú' });
  await search.fill('Dự đoán bỏ học');
  await expect(page.locator('.graph-panel [role="listbox"] [role="option"]').first()).toContainText(
    'Dự đoán bỏ học',
  );
  await search.fill('');

  // wiki/log.md: exactly one new line, written by the server.
  const logAfter = onDisk('wiki/log.md');
  expect(logAfter.startsWith(logBefore.trimEnd())).toBe(true);
  const added = logAfter
    .slice(logBefore.trimEnd().length)
    .split('\n')
    .filter((l) => l.trim());
  expect(begun.data.source.title).toBe(
    'Predicting Course Dropout from Weekly Activity with Sequence Models',
  );
  expect(added).toEqual([`## [${localIso()}] ingest | ${begun.data.source.title}`]);
  expect(done.data.logLine).toBe(added[0]);

  // Same content again: refused.
  const again = await mcp.call('ingest_begin', { sourceId: source!.sourceId });
  expect(again.isError).toBe(true);
  expect(again.data).toMatchObject({ code: 'EXISTS', details: { reason: 'already-ingested' } });

  // The paper page opens from the list and carries the AI banner.
  await pages.first().click();
  await expect(page).toHaveURL(/#\/note\?path=wiki%2Fpapers%2Fdropout-prediction/);
  await expect(page.getByText('AI duy trì trang này.')).toBeVisible();
  await expect(noteBody(page)).toContainText('Khoảng trống và động lực');
  await expect(noteBody(page)).toContainText('Input:');

  // An MCP write to the open page shows in the editor within 1 s (F32.5).
  const open = await mcp.call('read_note', { path: PAPER });
  const rewrite = await mcp.call('write_wiki_page', {
    path: PAPER,
    content: open.data.content.replace(
      '## Liên quan',
      'Cập nhật từ Claude (tr. 1).\n\n## Liên quan',
    ),
    expectedRevision: open.data.revision,
  });
  expect(rewrite.isError, JSON.stringify(rewrite.data)).toBe(false);
  const written = Date.now();
  await expect(noteBody(page)).toContainText('Cập nhật từ Claude', { timeout: 1_000 });
  console.log(`MCP write visible in the open note after ${Date.now() - written} ms`);
});

test('/mcp refuses a request without the token and one from a foreign Origin (F32.1)', async ({
  request,
}) => {
  const token = settingsToken(server.home);
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1' },
    },
  };
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const url = `${server.origin}/mcp`;
  const noToken = await request.post(url, { headers, data: body });
  expect(noToken.status()).toBe(401);
  const wrongToken = await request.post(url, {
    headers: { ...headers, authorization: 'Bearer not-the-token' },
    data: body,
  });
  expect(wrongToken.status()).toBe(401);
  const foreign = await request.post(url, {
    headers: { ...headers, authorization: `Bearer ${token}`, origin: 'http://evil.example' },
    data: body,
  });
  expect(foreign.status()).toBe(403);
  // The REST session token header is not a substitute for the bearer token on /mcp.
  const restHeader = await request.post(url, {
    headers: { ...headers, 'x-sb-token': token },
    data: body,
  });
  expect(restHeader.status()).toBe(401);
  // Control: the same request with the bearer token and no Origin is served.
  const ok = await request.post(url, {
    headers: { ...headers, authorization: `Bearer ${token}` },
    data: body,
  });
  expect(ok.status(), await ok.text()).toBe(200);
});
