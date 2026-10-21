/**
 * Hidden top folders (an old Obsidian `.trash/` of deleted notes, `.obsidian/`) are never in the
 * default AI scope: the status scope and the consent dialog never name them, so nothing in them
 * may be sent. Naming one in the folder list still lets AI read it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { effectiveScope, listTopFolders, pathInScope } from '../../../src/ai/runtime/ai-scope.js';
import { ask, createAiTestApp, type AiTestApp } from '../answers/ai-test-app.js';
import { createFakeAiRuntime } from '../answers/fake-ai-runtime.js';

describe('hidden folders and the default AI scope (F33.4)', () => {
  let a: AiTestApp;
  const runtime = createFakeAiRuntime({
    folders: null,
    replies: {
      intent: () => '{"kind":"text","from":null,"to":null,"overdue":false,"about":[]}',
      chat: 'Trả lời [S1].',
    },
  });
  beforeAll(async () => {
    a = await createAiTestApp(47614, {
      files: {
        '2 Areas/Xác suất.md': 'Phân phối chuẩn.\n',
        '.trash/Nhật ký riêng.md': 'Phân phối chuẩn và bí mật zxq đã xoá.\n',
        '.obsidian/ghi chú.md': 'Phân phối chuẩn zxq.\n',
      },
      runtime,
    });
  });
  afterAll(async () => a?.t.close());

  it('the default scope leaves hidden folders out, as the status scope does', () => {
    expect(pathInScope('.trash/Nhật ký riêng.md', null)).toBe(false);
    expect(pathInScope('.obsidian/ghi chú.md', null)).toBe(false);
    expect(pathInScope('2 Areas/Xác suất.md', null)).toBe(true);
    expect(pathInScope('.trash/Nhật ký riêng.md', ['', '.trash'])).toBe(true);
    expect(effectiveScope(null, listTopFolders(a.t.vaultRoot))).not.toContain('.trash');
  });

  it('a question sends nothing from them', async () => {
    const res = await ask(a.t, { question: 'Phân phối chuẩn là gì?' });
    const sources = res.meta.sources.map((s: { path: string }) => s.path);
    expect(sources).toEqual(['2 Areas/Xác suất.md']);
    expect(runtime.sentTexts().join('\n')).not.toContain('zxq');
  });
});
