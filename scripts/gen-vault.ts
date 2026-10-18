// Generates a synthetic vault for performance tests (default: 5,000 notes ≈ 50 MB, ≈ 20,000
// links, ≈ 3,000 tasks). Never writes into the real vault and never into a non-empty folder.
// Usage: npm run gen-vault -- --out <dir> [--notes 5000] [--seed 42] [--today YYYY-MM-DD]
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultTotals, planNotes, type PlannedNote } from './lib/gen-vault/note-plan.js';
import { emptyStats, renderNote } from './lib/gen-vault/note-render.js';
import { assertSafeOutDir, knownVaultDirs } from './lib/gen-vault/out-dir-safety.js';
import { createRng, localToday } from './lib/gen-vault/prng.js';
import { templateFiles, VAULT_FOLDERS } from './lib/gen-vault/template-files.js';
import { appRoot, isMainModule } from './lib/script-utils.js';

export interface GenVaultOptions {
  outDir: string;
  notes: number;
  seed: number;
  today: string;
  /** The owner's vault folder(s); the generator refuses to write into any of them. */
  realVaultDir: string | string[];
}

export interface GenVaultSummary {
  seed: number;
  today: string;
  notes: number;
  templates: number;
  bytes: number;
  folders: Record<string, number>;
  links: ReturnType<typeof emptyStats>['links'];
  frontmatterCourseLinks: number;
  tasks: ReturnType<typeof emptyStats>['tasks'];
  projects: number;
  projectsWithDeadline: number;
  tags: number;
  duplicateTitles: number;
  crlfFiles: number;
  nfdNames: number;
}

const HUB_ORDER: PlannedNote['kind'][] = [
  'course',
  'wiki-concept',
  'project',
  'lecture',
  'wiki-paper',
];

function hubFirst(notes: PlannedNote[]): PlannedNote[] {
  const rank = (n: PlannedNote) => {
    const i = HUB_ORDER.indexOf(n.kind);
    return i === -1 ? HUB_ORDER.length : i;
  };
  return notes.filter((n) => n.kind !== 'wiki-control').sort((a, b) => rank(a) - rank(b));
}

function writeVaultFile(outDir: string, relPath: string, text: string): number {
  const full = path.join(outDir, ...relPath.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
  return Buffer.byteLength(text);
}

export function generateVault(opts: GenVaultOptions): GenVaultSummary {
  assertSafeOutDir(opts.outDir, opts.realVaultDir);
  const rng = createRng(opts.seed);
  const plan = planNotes(defaultTotals(opts.notes), rng, opts.today);
  const duplicateTitles = new Set(plan.filter((n) => n.duplicateTitle).map((n) => n.title));
  const stats = emptyStats();
  const ctx = { rng, today: opts.today, targets: hubFirst(plan), duplicateTitles, stats };
  for (const folder of VAULT_FOLDERS)
    mkdirSync(path.join(opts.outDir, ...folder.split('/')), { recursive: true });

  let bytes = 0;
  const folders: Record<string, number> = {};
  for (const note of plan) {
    let text = renderNote(note, ctx);
    if (note.crlf) text = text.replace(/\n/g, '\r\n');
    const dir = path.posix.dirname(note.relPath);
    const fileName = note.nfdName
      ? path.posix.basename(note.relPath).normalize('NFD')
      : path.posix.basename(note.relPath);
    bytes += writeVaultFile(opts.outDir, `${dir}/${fileName}`, text);
    const top = note.relPath.split('/')[0] ?? '';
    folders[top] = (folders[top] ?? 0) + 1;
  }
  const templates = templateFiles(opts.today);
  for (const [rel, text] of Object.entries(templates)) writeVaultFile(opts.outDir, rel, text);

  const summary: GenVaultSummary = {
    seed: opts.seed,
    today: opts.today,
    notes: plan.length,
    templates: Object.keys(templates).length,
    bytes,
    folders,
    links: stats.links,
    frontmatterCourseLinks: stats.frontmatterCourseLinks,
    tasks: stats.tasks,
    projects: plan.filter((n) => n.kind === 'project').length,
    projectsWithDeadline: stats.projectsWithDeadline,
    tags: stats.tagsUsed.size,
    duplicateTitles: duplicateTitles.size,
    crlfFiles: plan.filter((n) => n.crlf).length,
    nfdNames: plan.filter((n) => n.nfdName).length,
  };
  writeVaultFile(
    opts.outDir,
    '.secondbrain/gen-vault-summary.json',
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function positiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

if (isMainModule(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        out: { type: 'string' },
        notes: { type: 'string' },
        seed: { type: 'string' },
        today: { type: 'string' },
      },
    });
    const today = values.today ?? localToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('--today must be YYYY-MM-DD');
    const outDir = path.resolve(values.out ?? mkdtempSync(path.join(tmpdir(), 'sb-gen-vault-')));
    const started = performance.now();
    const summary = generateVault({
      outDir,
      notes: positiveInt(values.notes, 'notes', 5000),
      seed: positiveInt(values.seed, 'seed', 42),
      today,
      realVaultDir: knownVaultDirs(path.resolve(appRoot, '..')),
    });
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      `gen-vault: wrote ${summary.notes} notes (${(summary.bytes / 1e6).toFixed(1)} MB) to ${outDir} in ${secs} s`,
    );
  } catch (err) {
    console.error(`gen-vault: ${(err as Error).message}`);
    process.exit(1);
  }
}
