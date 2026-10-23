/**
 * One line of `state/events.jsonl` (SPEC §4.15) as the graph history reads it: a JSON object
 * with an ISO `ts`, an `event` name and a `path` (NFC); `target`, `oldPath` and `approx` when
 * present. Anything else (truncated JSON, no valid instant) is null and skipped by the caller.
 */

export interface ParsedLogLine {
  ts: number;
  event: string;
  path: string;
  target?: string;
  oldPath?: string;
  approx: boolean;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value.normalize('NFC') : undefined;

export function parseLogLine(line: string): ParsedLogLine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  return parseLogRecord(raw);
}

/** The same checks on a line already parsed as JSON (an event of the shared log reader). */
export function parseLogRecord(raw: unknown): ParsedLogLine | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const path = text(record.path);
  const event = typeof record.event === 'string' ? record.event : undefined;
  const ts = typeof record.ts === 'string' ? Date.parse(record.ts) : Number.NaN;
  if (!path || !event || !Number.isFinite(ts)) return null;
  return {
    ts,
    event,
    path,
    target: text(record.target),
    oldPath: text(record.oldPath),
    approx: record.approx === true,
  };
}
