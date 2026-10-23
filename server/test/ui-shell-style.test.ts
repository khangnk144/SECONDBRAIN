import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderUiShell } from '../src/shell/render-ui-shell.js';
import { makeSettings, SHELL_TEMPLATE, TEST_TOKEN } from './helpers/test-environment.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('UI shell style attribute (F35.1)', () => {
  it('(F35.1) puts data-style on <html> before any script runs, and in the boot JSON', () => {
    for (const style of ['bento', 'calm'] as const) {
      const settings = makeSettings();
      settings.ui.style = style;
      const out = renderUiShell(SHELL_TEMPLATE, { token: TEST_TOKEN, ui: settings.ui });
      expect(out).toContain(`data-style="${style}"`);
      expect(out).toContain(`&quot;style&quot;:&quot;${style}&quot;`);
    }
  });

  it('(F35.1) the real index.html has the placeholder on <html>', () => {
    const html = readFileSync(path.join(here, '..', '..', 'web', 'index.html'), 'utf8');
    const open = html.slice(html.indexOf('<html'), html.indexOf('>', html.indexOf('<html')));
    expect(open).toContain('data-style="__SB_STYLE__"');
  });
});
