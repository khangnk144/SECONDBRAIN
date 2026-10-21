/**
 * The Today "Trợ lý" line (SPEC F33, PLAN §3 "Trợ lý deadline"): one sentence ≤ 160 characters
 * from Today's counts and the in-scope titles due today or overdue, generated at most once per
 * local day and language and cached in `.secondbrain/cache/ai-today.json` (derived data). Reading
 * the cache never calls the provider or writes anything.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../fs/atomic-write-file.js';
import type { DeadlineService } from '../../index/index-types.js';
import type { VaultPath } from '../../vault/vault-types.js';
import type { AiRuntime } from '../ai-types.js';
import { todaySummarySystem } from '../prompts/action-prompts.js';
import type { AnswerLanguage } from '../prompts/answer-language.js';
import { dataBlock } from '../prompts/data-blocks.js';

export const TODAY_CACHE_FILE = 'ai-today.json';
const MAX_LINE = 160;
const MAX_TITLES = 20;

interface TodayCache {
  version: 1;
  date: string;
  texts: Partial<Record<AnswerLanguage, string>>;
}

export interface TodaySummary {
  date: string;
  text: string | null;
}

const cacheFile = (cacheDir: string) => path.join(cacheDir, TODAY_CACHE_FILE);

async function readCache(cacheDir: string): Promise<TodayCache | null> {
  try {
    const value = JSON.parse(await readFile(cacheFile(cacheDir), 'utf8')) as TodayCache;
    if (value?.version !== 1 || typeof value.date !== 'string' || typeof value.texts !== 'object') {
      return null;
    }
    return value;
  } catch {
    return null; // missing or damaged: it is only a cache
  }
}

export async function cachedTodaySummary(
  cacheDir: string,
  date: string,
  language: AnswerLanguage,
): Promise<TodaySummary> {
  const cache = await readCache(cacheDir);
  const text = cache?.date === date ? cache.texts[language] : undefined;
  return { date, text: typeof text === 'string' ? text : null };
}

/** One line, no Markdown decoration, at most 160 characters (cut at a word, with "…"). */
export function cleanSummaryLine(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l !== '') ?? '';
  const plain = line.replace(/^["“*_\s]+|["”*_\s]+$/g, '').replace(/\s+/g, ' ');
  const chars = [...plain];
  if (chars.length <= MAX_LINE) return plain;
  const cut = chars.slice(0, MAX_LINE - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_LINE / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

export interface GenerateTodayDeps {
  runtime: Pick<AiRuntime, 'complete' | 'inScope'>;
  deadlines: Pick<DeadlineService, 'today'>;
  cacheDir: string;
  language: AnswerLanguage;
  signal?: AbortSignal;
}

function facts(deps: GenerateTodayDeps): { date: string; text: string } {
  const view = deps.deadlines.today();
  const inScope = (p: VaultPath) => deps.runtime.inScope(p);
  const vi = deps.language === 'vi';
  const due = [
    ...view.strip.overdue.map((item) => ({ item, overdue: true })),
    ...(view.strip.days[0]?.items ?? []).map((item) => ({ item, overdue: false })),
  ].filter(({ item }) => inScope(item.path));
  // The counts of Today's summary, over in-scope notes only (the same rules as `buildTodayView`).
  const thisWeek = view.strip.days
    .filter((day) => day.date <= view.week.end)
    .flatMap((day) => day.items)
    .filter((item) => inScope(item.path)).length;
  const openToday = view.todayTasks.filter(
    (task) => !task.done && (task.date === null || task.date >= view.date) && inScope(task.path),
  ).length;
  const overdue = view.strip.overdue.filter((item) => inScope(item.path)).length;
  const lines = [
    `${vi ? 'Deadline tuần này (từ hôm nay)' : 'Deadlines this week (from today)'}: ${thisWeek}`,
    `${vi ? 'Việc hôm nay còn mở' : 'Open tasks today'}: ${openToday}`,
    `${vi ? 'Quá hạn' : 'Overdue'}: ${overdue}`,
    `${vi ? 'Tên các mục hôm nay và quá hạn' : 'Items due today and overdue'}:`,
    dataBlock(
      'text',
      due
        .slice(0, MAX_TITLES)
        .map(
          ({ item, overdue }) =>
            `- ${item.title}${overdue ? (vi ? ' (quá hạn)' : ' (overdue)') : ''}`,
        )
        .join('\n') || '-',
    ),
  ];
  return { date: view.date, text: lines.join('\n') };
}

/** Generates (or returns the cached) line for today in `language`, then caches it. */
export async function generateTodaySummary(deps: GenerateTodayDeps): Promise<TodaySummary> {
  const { date, text } = facts(deps);
  const cached = await cachedTodaySummary(deps.cacheDir, date, deps.language);
  if (cached.text !== null) return cached;
  const reply = await deps.runtime.complete({
    purpose: 'today',
    system: todaySummarySystem(deps.language),
    messages: [{ role: 'user', content: text }],
    maxTokens: 120,
    temperature: 0.3,
    signal: deps.signal,
  });
  const line = cleanSummaryLine(reply.text);
  if (line === '') return { date, text: null };
  const previous = await readCache(deps.cacheDir);
  const texts = previous?.date === date ? { ...previous.texts } : {};
  texts[deps.language] = line;
  const cache: TodayCache = { version: 1, date, texts };
  // The cache folder is deletable derived data: it may be gone.
  await mkdir(deps.cacheDir, { recursive: true });
  await atomicWriteFile(cacheFile(deps.cacheDir), `${JSON.stringify(cache, null, 2)}\n`);
  return { date, text: line };
}

/** One running generation per key (vault, day, language), shared by concurrent requests. */
export function createSingleFlight<T>(): (key: string, run: () => Promise<T>) => Promise<T> {
  const running = new Map<string, Promise<T>>();
  return (key, run) => {
    const pending = running.get(key);
    if (pending) return pending;
    const started = run().finally(() => running.delete(key));
    running.set(key, started);
    return started;
  };
}
