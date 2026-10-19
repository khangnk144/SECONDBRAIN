/**
 * Markdown fixture corpus (`server/test/fixtures/markdown/`). Files are stored with LF line
 * endings (the repo normalizes them), so CRLF, BOM and NFD variants are derived here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'markdown',
);

export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

export function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

export interface FixtureVariant {
  label: string;
  content: string;
}

/** The fixture as stored plus CRLF, BOM + CRLF and NFD (macOS file content) variants. */
export function fixtureVariants(content: string): FixtureVariant[] {
  const crlf = content.replace(/\n/g, '\r\n');
  return [
    { label: 'LF', content },
    { label: 'CRLF', content: crlf },
    { label: 'BOM+CRLF', content: `\uFEFF${crlf}` },
    { label: 'NFD', content: content.normalize('NFD') },
  ];
}
