/**
 * How a commit reads in the history list: "Tự động lưu lúc 14:20, 21/10/2026" for the automatic
 * commits, "Khôi phục từ bản lúc …" for restores (the source version's time when it is in the
 * list), the subject line for commits made outside the app.
 */
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import 'dayjs/locale/en';
import type { TFunction } from 'i18next';
import type { HistoryCommit } from '../../lib/api/history-types';

const RESTORE_MESSAGE = /^restore: .* @ ([0-9a-f]{7,40})$/;

export function formatCommitTime(date: string, language: string, t: TFunction): string {
  return dayjs(date).locale(language).format(t('history.timeFormat'));
}

/** The short hash a restore commit names as its source, or null for other commits. */
export function restoredFrom(commit: HistoryCommit): string | null {
  return RESTORE_MESSAGE.exec(commit.message)?.[1] ?? null;
}

export interface CommitLabel {
  title: string;
  /** Second line (time of a restore or outside commit); null when the title already says it. */
  detail: string | null;
}

export function commitLabel(
  commit: HistoryCommit,
  commits: readonly HistoryCommit[],
  language: string,
  t: TFunction,
): CommitLabel {
  const time = formatCommitTime(commit.date, language, t);
  if (commit.auto) return { title: t('history.autoSaved', { time }), detail: null };
  const source = restoredFrom(commit);
  if (source) {
    const original = commits.find(
      (c) => c.commit.startsWith(source) || source.startsWith(c.shortCommit),
    );
    const title = original
      ? t('history.restoredFromTime', { time: formatCommitTime(original.date, language, t) })
      : t('history.restoredFromCommit', { commit: source.slice(0, 7) });
    return { title, detail: time };
  }
  return { title: commit.message.trim() || commit.shortCommit, detail: time };
}
