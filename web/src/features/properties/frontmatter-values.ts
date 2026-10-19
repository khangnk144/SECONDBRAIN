/**
 * Reads the front matter block for the property bar (F7): YAML core schema, so `2026-11-05`
 * stays the string the file holds. Invalid YAML (or a root that is not a mapping) is reported,
 * never repaired; the bar is then read-only.
 */
import { isMap, isNode, isScalar, parseDocument } from 'yaml';

export type PropertyKind =
  'date' | 'status' | 'type' | 'course' | 'tags' | 'list' | 'text' | 'complex';

export interface PropertyEntry {
  key: string;
  value: unknown;
  kind: PropertyKind;
  /** YAML text of a value the bar cannot edit (nested lists, mappings). */
  yaml?: string;
}

export type ParsedFrontmatter =
  | { status: 'none' }
  | { status: 'invalid'; raw: string }
  | { status: 'ok'; entries: PropertyEntry[] };

export const STATUS_VALUES = ['todo', 'doing', 'done'] as const;
export const TYPE_VALUES = [
  'note',
  'project',
  'course',
  'lecture',
  'paper',
  'research',
  'daily',
  'book',
  'wiki',
] as const;
/** Keys with a localized label (SPEC §4.3); any other key shows as written. */
export const KNOWN_KEYS = ['type', 'status', 'deadline', 'course', 'tags', 'created'] as const;
export const DATE_KEYS = new Set(['deadline', 'created']);
/** Same rule as the server's property patcher. */
export const PROPERTY_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const isScalarValue = (value: unknown) =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

export function kindOf(key: string, value: unknown): PropertyKind {
  if (Array.isArray(value)) {
    if (!value.every(isScalarValue)) return 'complex';
    return key === 'tags' ? 'tags' : 'list';
  }
  if (!isScalarValue(value)) return 'complex';
  if (key === 'tags') return 'tags';
  if (DATE_KEYS.has(key) || isIsoDate(value)) return 'date';
  if (key === 'status' || key === 'type' || key === 'course') return key;
  return 'text';
}

/** The YAML between the fences of a front matter block (fences and line ends as in the file). */
export function frontmatterYaml(raw: string): string {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  // First line is the opening fence; the closing fence is the last non-empty line.
  let end = lines.length - 1;
  while (end > 0 && lines[end] === '') end -= 1;
  return lines.slice(1, end).join('\n');
}

export function parseFrontmatter(raw: string | null): ParsedFrontmatter {
  if (raw === null) return { status: 'none' };
  const source = frontmatterYaml(raw);
  const document = parseDocument(source, { schema: 'core', uniqueKeys: true });
  if (document.errors.length > 0) return { status: 'invalid', raw };
  const root = document.contents;
  if (root === null || (isScalar(root) && root.value === null))
    return { status: 'ok', entries: [] };
  if (!isMap(root) || root.flow) return { status: 'invalid', raw };
  // A Map keeps the file's key order (a plain object would move number-like keys first).
  const values = [...(document.toJS({ mapAsMap: true }) as Map<unknown, unknown>).entries()];
  const entries: PropertyEntry[] = [];
  root.items.forEach((pair, index) => {
    const [key, value] = values[index] ?? [pair.key, null];
    const name = String(key);
    const kind = kindOf(name, value);
    entries.push({
      key: name,
      value,
      kind,
      yaml: kind === 'complex' ? sourceOf(source, pair.value) : undefined,
    });
  });
  return { status: 'ok', entries };
}

function sourceOf(source: string, node: unknown): string {
  const range = isNode(node) ? node.range : null;
  return range ? source.slice(range[0], range[1]).trim() : '';
}

/** `[[Giải tích 1]]` → `Giải tích 1` (alias kept when present). */
export function wikilinkText(value: string): string {
  const match = /^\s*\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]\s*$/.exec(value);
  if (!match) return value;
  const target = match[1] ?? '';
  return match[2] ?? target.slice(target.lastIndexOf('/') + 1);
}
