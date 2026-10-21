/// <reference lib="dom" />
// Graph at the SPEC F16.1 size, 3,000 notes and 6,000 links (soft, reported): layout time and fps
// after settling, headless with software rendering (the reference-machine fps is a manual check).
// Opt-in with SB_PERF=1; the vault is written into a fresh temporary home served on port 4798.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { measureGraph } from './helpers/perf-graph.js';
import { PERF_ORIGIN, perfServer, type PerfServer } from './helpers/perf-server.js';

test.skip(process.env.SB_PERF !== '1', 'set SB_PERF=1 (writes a 3k vault, second server)');

const NOTES = 3_000;
const LINKS = 6_000;
const FOLDERS = ['1 Projects', '2 Areas', '3 Resources', 'wiki', 'Daily', '0 Inbox'];
let server: PerfServer | null = null;

/** 3,000 notes; 6,000 distinct links between random pairs (seeded, so runs compare). */
function writeVault(dir: string): void {
  let seed = 42;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const name = (i: number) => `Ghi chú đồ thị ${String(i).padStart(4, '0')}`;
  const links: string[][] = Array.from({ length: NOTES }, () => []);
  const pairs = new Set<string>();
  while (pairs.size < LINKS) {
    const a = Math.floor(random() * NOTES);
    const b = Math.floor(random() * NOTES);
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || pairs.has(key)) continue;
    pairs.add(key);
    links[a]!.push(name(b));
  }
  for (const folder of FOLDERS) mkdirSync(path.join(dir, folder), { recursive: true });
  for (let i = 0; i < NOTES; i += 1) {
    const body = links[i]!.map((target) => `- [[${target}]]`).join('\n');
    writeFileSync(
      path.join(dir, FOLDERS[i % FOLDERS.length]!, `${name(i)}.md`),
      `---\ntype: note\n---\n\n# ${name(i)}\n\n${body}\n`,
    );
  }
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  server = perfServer();
  writeVault(server.vaultDir);
  await server.start();
});

test.afterAll(() => server?.stop());

test('graph layout time and fps at 3,000 nodes / 6,000 edges (F16.1, headless)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const result = await measureGraph(page, PERF_ORIGIN);
  const out = path.join(test.info().project.outputDir, 'perf-graph-3k.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`perf-graph-3k: ${JSON.stringify(result)}`);
});
