import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatRequest } from '../../../src/ai/ai-types.js';
import { snapshotTree } from '../../api/vault-test-app.js';
import { createAiTestApp, type AiTestApp } from '../answers/ai-test-app.js';
import { createFakeAiRuntime } from '../answers/fake-ai-runtime.js';

const FILES = {
  '2 Areas/Xác suất.md':
    '---\ntags: [môn/xác-suất]\n---\n\nPhân phối chuẩn và kỳ vọng. #thống-kê\n',
  '2 Areas/Giải tích.md': 'Đạo hàm và tích phân. #môn/giải-tích\n',
  '1 Projects/Đồ án.md': 'Đồ án dùng [[Giải tích]] và phân phối chuẩn. #đồ-án\n',
  '1 Projects/Học kỳ 1/Môn A/Bài 1.md': 'Bài một.\n',
  '0 Inbox/ghi chu nhanh.md': 'Ôn tập phân phối chuẩn cho môn xác suất.\n',
  '0 Inbox/Sub/Nhỏ.md': 'Nhỏ.\n',
  '4 Archive/Cũ.md': 'Phân phối chuẩn bí mật. #bí-mật-lưu-trữ\n',
  '4 Archive/Bí mật kho/Kho.md': 'Kho.\n',
  '3 Resources/Tài liệu.md': 'Phân phối chuẩn trong sách.\n',
};

/** Candidate id the server offered for `path` in a suggestion request. */
function candidateId(request: ChatRequest, path: string): string | null {
  const content = request.messages[0]!.content;
  const match = new RegExp(`<source id="(C\\d+)" path="${path}"`).exec(content);
  return match ? match[1]! : null;
}

describe('editor actions and Inbox tidying through the API (R1)', () => {
  let a: AiTestApp;
  const last = () => a.runtime.requests.at(-1)!;
  const act = (body: unknown) => a.t.call('POST', '/api/ai/action', body);

  beforeAll(async () => {
    a = await createAiTestApp(47744, {
      files: FILES,
      runtime: createFakeAiRuntime({ replies: {} }),
    });
  });
  afterAll(async () => a?.t.close());

  it('summarize, improve and explain send the selection as data and return text', async () => {
    const replies = a.runtime.options.replies!;
    replies.action = '```markdown\nĐoạn đã viết lại.\n```';
    const res = await act({
      action: 'improve',
      text: 'doan van  chua hay',
      path: '0 Inbox/ghi chu nhanh.md',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ action: 'improve', text: 'Đoạn đã viết lại.' });
    expect(last()).toMatchObject({ purpose: 'action', call: 'complete' });
    expect(last().messages[0]!.content).toBe('<text>\ndoan van  chua hay\n</text>');
    expect(last().system).toMatch(/Giữ nguyên ý và giữ nguyên ngôn ngữ/);
    for (const action of ['summarize', 'explain'] as const) {
      replies.action = `Kết quả ${action}`;
      const r = await act({ action, text: 'Phân phối chuẩn là gì' });
      expect(r.json()).toEqual({ action, text: `Kết quả ${action}` });
      expect(last().system).toMatch(/không phải chỉ dẫn/);
    }
  });

  it.each([
    ['empty text', { action: 'summarize', text: '   ' }, 'required'],
    ['text too long', { action: 'summarize', text: 'x'.repeat(20_001) }, 'too-long'],
    ['unknown field', { action: 'summarize', text: 'x', model: 'gpt' }, 'unknown-field'],
    ['unknown action', { action: 'translate', text: 'x' }, 'not-allowed'],
    [
      'note outside the scope',
      { action: 'summarize', text: 'x', path: '4 Archive/Cũ.md' },
      'out-of-scope',
    ],
    ['not a note', { action: 'summarize', text: 'x', path: '2 Areas/a.pdf' }, 'not-a-note'],
    [
      'placement with text',
      { action: 'suggest-placement', path: '0 Inbox/ghi chu nhanh.md', text: 'x' },
      'unknown-field',
    ],
    [
      'placement outside Inbox',
      { action: 'suggest-placement', path: '1 Projects/Đồ án.md' },
      'not-in-inbox',
    ],
    [
      'placement in an Inbox subfolder',
      { action: 'suggest-placement', path: '0 Inbox/Sub/Nhỏ.md' },
      'not-in-inbox',
    ],
    ['placement without a path', { action: 'suggest-placement' }, 'required'],
  ])('refuses %s with VALIDATION and sends nothing', async (_label, body, reason) => {
    const before = a.runtime.requests.length;
    const res = await act(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION', details: { reason } });
    expect(a.runtime.requests.length).toBe(before);
  });

  it('refuses a guarded-out path with INVALID_PATH', async () => {
    for (const path of ['../x.md', '.secondbrain/vault.json', '/etc/passwd']) {
      const res = await act({ action: 'summarize', text: 'x', path });
      expect(res.json().error.code).toBe('INVALID_PATH');
    }
  });

  it('suggest-links offers in-scope candidates only and keeps only offered picks', async () => {
    a.runtime.options.replies!.action = (request) => {
      const id = candidateId(request, '2 Areas/Xác suất.md');
      return JSON.stringify({
        links: [
          { id, reason: 'Cùng nói về phân phối chuẩn.\nDòng hai' },
          { id: 'C9', reason: 'không có' },
          { path: '4 Archive/Cũ.md', reason: 'ngoài phạm vi' },
          { id, reason: 'lặp lại' },
        ],
      });
    };
    const res = await act({
      action: 'suggest-links',
      text: 'Phân phối chuẩn, đạo hàm và kỳ vọng',
      path: '1 Projects/Đồ án.md',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      links: [
        {
          path: '2 Areas/Xác suất.md',
          title: 'Xác suất',
          reason: 'Cùng nói về phân phối chuẩn. Dòng hai',
        },
      ],
    });
    const sent = last().messages[0]!.content;
    expect(last().json).toBe(true);
    // The note itself and the note it already links to are not candidates.
    expect(sent).not.toContain('path="1 Projects/Đồ án.md"');
    expect(sent).not.toContain('path="2 Areas/Giải tích.md"');
    expect(sent).not.toMatch(/4 Archive|3 Resources|bí mật/);
  });

  it('suggest-links answers [] without a call when nothing is related, 502 on a malformed reply', async () => {
    const before = a.runtime.requests.length;
    const none = await act({ action: 'suggest-links', text: 'Quark lepton boson' });
    expect(none.json()).toEqual({ links: [] });
    expect(a.runtime.requests.length).toBe(before);
    a.runtime.options.replies!.action = 'not json';
    const bad = await act({ action: 'suggest-links', text: 'phân phối chuẩn' });
    expect(bad.statusCode).toBe(502);
    expect(bad.json().error).toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      details: { reason: 'malformed' },
    });
  });

  it("suggest-tags normalizes, prefers existing in-scope tags and skips the note's own", async () => {
    a.runtime.options.replies!.action = JSON.stringify({
      tags: [
        'Phân phối chuẩn',
        'Môn/Xác Suất',
        '#đồ-án',
        '!!!',
        '2026',
        'bí-mật-lưu-trữ',
        'thống kê',
      ],
    });
    const res = await act({
      action: 'suggest-tags',
      text: 'Phân phối chuẩn',
      path: '1 Projects/Đồ án.md',
    });
    expect(res.json()).toEqual({
      tags: [
        { tag: 'môn/xác-suất', existing: true },
        { tag: 'thống-kê', existing: true },
        { tag: 'phân-phối-chuẩn', existing: false },
        { tag: 'bí-mật-lưu-trữ', existing: false },
      ],
    });
    const offered = /<tags>\n(.*)\n<\/tags>/.exec(last().messages[0]!.content)![1]!;
    expect(offered.split(' ').sort()).toEqual(
      ['#môn/giải-tích', '#môn/xác-suất', '#thống-kê', '#đồ-án'].sort(),
    );

    a.runtime.options.replies!.action = JSON.stringify({
      tags: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'],
    });
    expect((await act({ action: 'suggest-tags', text: 'x' })).json().tags).toHaveLength(5);
  });

  it('suggest-placement proposes a candidate folder and a clean title, and moves nothing', async () => {
    const before = snapshotTree(a.t.vaultRoot, (p) => p.startsWith('.secondbrain'));
    a.runtime.options.replies!.action = JSON.stringify({
      folder: '2 areas/',
      title: 'Ôn tập: phân phối chuẩn?',
      reason: 'Thuộc môn xác suất.',
      keep: false,
    });
    const res = await act({ action: 'suggest-placement', path: '0 Inbox/ghi chu nhanh.md' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      current: { folder: '0 Inbox', title: 'ghi chu nhanh' },
      folder: '2 Areas',
      title: 'Ôn tập phân phối chuẩn',
      reason: 'Thuộc môn xác suất.',
      keep: false,
    });
    const candidates = /<candidates>\n([\s\S]*?)\n<\/candidates>/.exec(
      last().messages[0]!.content,
    )![1]!;
    expect(candidates.split('\n')).toEqual([
      '1 Projects',
      '2 Areas',
      '3 Resources',
      '4 Archive',
      '1 Projects/Học kỳ 1',
      '1 Projects/Học kỳ 1/Môn A',
    ]);
    expect(last().messages[0]!.content).not.toMatch(/Bí mật kho|Tài liệu|Cũ/);
    expect(snapshotTree(a.t.vaultRoot, (p) => p.startsWith('.secondbrain'))).toEqual(before);
  });

  it('suggest-placement: a folder outside the candidates is refused, keep stays put', async () => {
    a.runtime.options.replies!.action = JSON.stringify({
      folder: '4 Archive/Bí mật kho',
      title: 'x',
      keep: false,
    });
    const bad = await act({ action: 'suggest-placement', path: '0 Inbox/ghi chu nhanh.md' });
    expect(bad.statusCode).toBe(502);
    expect(bad.json().error.details.reason).toBe('invalid-answer');
    a.runtime.options.replies!.action = JSON.stringify({
      folder: null,
      title: 'x',
      reason: 'Chưa rõ.',
      keep: true,
    });
    const keep = await act({ action: 'suggest-placement', path: '0 Inbox/ghi chu nhanh.md' });
    expect(keep.json()).toEqual({
      current: { folder: '0 Inbox', title: 'ghi chu nhanh' },
      folder: '0 Inbox',
      title: 'ghi chu nhanh',
      reason: 'Chưa rõ.',
      keep: true,
    });
  });
});
