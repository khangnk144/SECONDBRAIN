/**
 * Note and source text goes into prompts only inside delimited blocks (`<source …>…</source>`,
 * `<text>…</text>`), and every system prompt says these blocks are data, never instructions.
 * Text that tries to close or open such a block itself is neutralized, so a note cannot end its
 * own block early and pose as the app's instructions.
 */

/** Tag names the prompts use for data blocks. */
const BLOCK_TAGS = [
  'source',
  'sources',
  'text',
  'note',
  'topics',
  'question',
  'candidates',
  'tags',
];
const BLOCK_TAG = new RegExp(`<(/?)\\s*(${BLOCK_TAGS.join('|')})\\b`, 'giu');

/** Replaces `<source`, `</text` … inside data with a look-alike that is not a tag. */
export function neutralizeBlockTags(text: string): string {
  return text.replace(BLOCK_TAG, (_match, slash: string, name: string) => `‹${slash}${name}`);
}

function attribute(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export interface SourceBlockInfo {
  id: string;
  path: string;
  title: string;
  page?: number | null;
}

/** `<source id="S1" path="…" title="…" page="3">…</source>` */
export function sourceBlock(info: SourceBlockInfo, text: string): string {
  const page = info.page ? ` page="${info.page}"` : '';
  const head = `<source id="${attribute(info.id)}" path="${attribute(info.path)}" title="${attribute(info.title)}"${page}>`;
  return `${head}\n${neutralizeBlockTags(text).trim()}\n</source>`;
}

/** `<name>…</name>` around data (the user's selection, a note, a list of titles). */
export function dataBlock(name: string, text: string): string {
  return `<${name}>\n${neutralizeBlockTags(text).trim()}\n</${name}>`;
}
