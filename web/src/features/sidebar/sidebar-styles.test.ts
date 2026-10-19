import { beforeAll, describe, expect, it } from 'vitest';

// The web test project loads CSS as empty modules, so read the files from disk.
const FS = 'node:fs';
async function readCss(relative: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ FS)) as {
    readFileSync(path: URL, encoding: 'utf8'): string;
  };
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}

let sidebarCss = '';
let treeCss = '';

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

// jsdom has no layout, so these guard the CSS contracts the review asked for.
describe('sidebar styles', () => {
  beforeAll(async () => {
    sidebarCss = await readCss('../../styles/sidebar.css');
    treeCss = await readCss('./sidebar-tree.css');
  });

  it('only the folder tree scrolls; "Ghi chú mới" stays pinned at the bottom', () => {
    const folders = rule(sidebarCss, '.sidebar-folders');
    expect(folders).toMatch(/overflow-y:\s*auto/);
    expect(folders).toMatch(/min-height:\s*0/);
    expect(folders).toMatch(/flex:\s*1 1 0/);
    expect(rule(treeCss, '.sidebar-new-note')).toMatch(/margin-top:\s*auto/);
  });

  it('the inline rename field shows the 2 px --focus ring like every input', () => {
    const focus = rule(treeCss, '.tree-rename__input:focus,\n.tree-rename__input:focus-visible');
    expect(focus).toMatch(/outline:\s*2px solid var\(--focus\)/);
    expect(treeCss).not.toMatch(/outline:\s*none/);
  });
});
