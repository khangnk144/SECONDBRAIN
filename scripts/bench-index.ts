// Measures the index numbers of SPEC §5 on a freshly generated vault (default 5,000 notes):
// cold full index, incremental update of one file, the "open note" service path, search server
// query and Today. Prints a JSON report and a Markdown table with the machine it ran on.
// Never touches the real vault: the vault is generated into a new temp folder and removed after.
// Usage: npx tsx scripts/bench-index.ts [--notes 5000] [--seed 42] [--keep] [--strict]
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createDeadlineService } from '../server/src/index/deadline-service.js';
import { openIndex } from '../server/src/index/open-index.js';
import { toLocalDate } from '../server/src/lib/local-date.js';
import { openVault } from '../server/src/vault/open-vault.js';
import { generateVault } from './gen-vault.js';
import { knownVaultDirs } from './lib/gen-vault/out-dir-safety.js';
import { appRoot, isMainModule } from './lib/script-utils.js';

/** SPEC §5 budgets in milliseconds; `--strict` fails when a number exceeds its budget + 20 %. */
const BUDGETS = {
  coldIndex: 15e3,
  incrementalP95: 100,
  openNoteP95: 150,
  searchP95: 50,
  todayP95: 200,
};

/** Realistic palette queries: unaccented Vietnamese, prefixes as typed, filters, noise. */
const QUERIES = [
  ...'giai tich|giai|gi|dai so|dai so tuyen tinh|do an|đồ án giải tích|xac suat|ma tran'.split('|'),
  ...'dinh thuc|gradient|transformer|phuong phap nghien cuu|bai giang buoi 3|hoc may'.split('|'),
  ...'tich phan|ky vong|research gap|on tap|tag:đồ-án|tag:môn|folder:"2 Areas" giai'.split('|'),
  ...'type:project|due:7d|tag:đồ-án due:30d|class:archive due:overdue|"ghi chu|c++ (a'.split('|'),
  ...['xyz khong co', 'Giải tích'.normalize('NFD')],
];

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

async function time<T>(fn: () => T | Promise<T>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

/** Times `fn(0)` … `fn(n - 1)`, one after the other. */
async function samples(n: number, fn: (i: number) => unknown): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(await time(() => fn(i)));
  return out;
}

const machine = () => ({
  cpu: os.cpus()[0]?.model.trim() ?? 'unknown',
  cores: os.cpus().length,
  ramGb: Math.round(os.totalmem() / 2 ** 30),
  os: `${os.type()} ${os.release()} ${os.arch()}`,
  node: process.version,
});

export async function runBench(options: { notes: number; seed: number; keep: boolean }) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'sb bench index Đồ án '));
  const root = path.join(base, 'vault');
  try {
    const today = toLocalDate(new Date());
    const summary = generateVault({
      outDir: root,
      notes: options.notes,
      seed: options.seed,
      today,
      realVaultDir: knownVaultDirs(path.resolve(appRoot, '..')),
    });
    const { vault } = await openVault({ root });
    const warnings: string[] = [];
    // Cold: no index file and a fresh process (the OS file cache is warm from generation).
    const coldStart = performance.now();
    let index = await openIndex({ vault, onWarning: (m) => warnings.push(m) });
    const coldIndex = performance.now() - coldStart;
    const reopen = await time(async () => {
      index.close();
      index = await openIndex({ vault });
    });

    const notes = index.listNotes().filter((n) => n.class === 'user' && n.path.endsWith('.md'));
    const pick = (i: number) => notes[(i * 7919) % notes.length]!;
    const incremental: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      const note = pick(i);
      appendFileSync(
        path.join(root, ...note.path.split('/')),
        `\nSửa lần ${i}: xem [[${pick(i + 1).title}]] #bench\n`,
      );
      incremental.push(await time(() => index.updateFile(note.path)));
    }
    const openNote = await samples(100, async (i) => {
      const p = pick(i * 3).path;
      // What GET /note does: the file plus its index facts.
      return [
        await vault.read(p),
        index.getNote(p),
        index.backlinks(p),
        index.outlinks(p),
        index.noteTags(p),
      ];
    });
    for (const q of QUERIES) index.search({ q });
    const search: number[] = [];
    const perQuery: Record<string, number> = {};
    for (const q of QUERIES) {
      const runs = await samples(5, () => index.search({ q }));
      perQuery[q] = Math.max(...runs);
      search.push(...runs);
    }
    const deadlines = createDeadlineService(index, () => new Date());
    deadlines.today();
    const todayRuns = await samples(50, () => deadlines.today());
    index.close();
    await vault.close();

    const ms = (n: number) => Math.round(n * 10) / 10;
    const results = {
      coldIndex: ms(coldIndex),
      warmOpen: ms(reopen),
      incrementalP95: ms(percentile(incremental, 95)),
      openNoteP95: ms(percentile(openNote, 95)),
      searchP95: ms(percentile(search, 95)),
      todayP95: ms(percentile(todayRuns, 95)),
    };
    const slowestQueries = Object.entries(perQuery)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([q, t]) => ({ q, ms: ms(t) }));
    const vaultInfo = {
      notes: summary.notes,
      mb: Math.round(summary.bytes / 1e5) / 10,
      links: summary.links.total,
      tasks: summary.tasks.total,
    };
    return {
      machine: machine(),
      vault: vaultInfo,
      results,
      budgets: BUDGETS,
      slowestQueries,
      parseWarnings: warnings.length,
    };
  } finally {
    if (options.keep) console.log(`bench-index: kept ${root}`);
    else rmSync(base, { recursive: true, force: true });
  }
}

type Report = Awaited<ReturnType<typeof runBench>>;

export function markdownTable(report: Report): string {
  const rows: [string, number, number | null][] = [
    ['Cold full index', report.results.coldIndex, BUDGETS.coldIndex],
    ['Warm open (index exists, reconcile)', report.results.warmOpen, null],
    ['Incremental update, p95 (100 runs)', report.results.incrementalP95, BUDGETS.incrementalP95],
    ['Open note service path, p95 (100 runs)', report.results.openNoteP95, BUDGETS.openNoteP95],
    [
      `Search server query, p95 (${QUERIES.length} queries × 5)`,
      report.results.searchP95,
      BUDGETS.searchP95,
    ],
    ['Today, p95 (50 runs)', report.results.todayP95, BUDGETS.todayP95],
  ];
  const m = report.machine;
  return [
    `Vault: ${report.vault.notes} notes, ${report.vault.mb} MB, ${report.vault.links} links, ${report.vault.tasks} tasks`,
    `Machine: ${m.cpu}, ${m.cores} cores, ${m.ramGb} GB RAM, ${m.os}, Node ${m.node}`,
    '',
    '| Metric | Measured (ms) | Budget (ms) | Status |',
    '|---|---:|---:|---|',
    ...rows.map(
      ([name, value, budget]) =>
        `| ${name} | ${value} | ${budget ?? '–'} | ${budget === null ? '–' : value <= budget ? 'ok' : value <= budget * 1.2 ? 'within +20 %' : 'over'} |`,
    ),
  ].join('\n');
}

if (isMainModule(import.meta.url)) {
  const flag = { type: 'boolean' } as const;
  const text = { type: 'string' } as const;
  const { values } = parseArgs({ options: { notes: text, seed: text, keep: flag, strict: flag } });
  runBench({
    notes: Number(values.notes ?? 5000),
    seed: Number(values.seed ?? 42),
    keep: values.keep === true,
  })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      console.log(`\n${markdownTable(report)}`);
      const over = (Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]).filter(
        (k) => report.results[k] > BUDGETS[k] * 1.2,
      );
      if (values.strict && over.length > 0) {
        console.error(`bench-index: over budget: ${over.join(', ')}`);
        process.exit(1);
      }
    })
    .catch((error: unknown) => {
      console.error(`bench-index: ${(error as Error).stack ?? String(error)}`);
      process.exit(1);
    });
}
