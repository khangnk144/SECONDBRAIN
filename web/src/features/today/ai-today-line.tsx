import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generateTodaySummary, getTodaySummary } from '../../lib/api/ai-api';
import { useAiReady } from '../../lib/ai-status-store';
import { useLocalDay } from '../../lib/local-day';
import './ai-today-line.css';

/** Days this window already asked the server to write the line for (one try per day). */
const generatedDays = new Set<string>();
/** The last line shown, so coming back to Today does not flash. */
let shown: { day: string; text: string } | null = null;

async function loadSummary(day: string): Promise<string | null> {
  const cached = await getTodaySummary();
  if (cached.text !== null || generatedDays.has(day)) return cached.text;
  // Marked before the call: a failure, a reload of the status or a second Today never repeat it.
  generatedDays.add(day);
  return (await generateTodaySummary()).text;
}

/**
 * Today's "Trợ lý" line (SPEC F33, F10 stays quiet): when AI is ready, one sentence from the
 * server's daily summary under the summary line, marked as the AI's. The server writes it at most
 * once a day; this window asks it to at most once a day. Nothing at all when AI is not ready,
 * while loading or on any error (never a nag).
 */
export function AiTodayLine() {
  const { t } = useTranslation();
  const ready = useAiReady();
  const day = useLocalDay();
  const [text, setText] = useState<string | null>(() => (shown?.day === day ? shown.text : null));

  useEffect(() => {
    if (!ready) return;
    let live = true;
    if (shown?.day !== day) setText(null);
    loadSummary(day).then(
      (result) => {
        if (!live) return;
        shown = result === null ? null : { day, text: result };
        setText(result);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ready, day]);

  if (!ready || text === null || text.trim() === '') return null;
  return (
    <p className="ai-today-line">
      <span className="ai-today-line__label" aria-hidden="true">
        {t('ai-chat.today.label')}
      </span>
      <span className="visually-hidden">{t('ai-chat.today.labelFull')} </span>
      <span>{text}</span>
    </p>
  );
}

/** Tests: forget what this window asked for and showed. */
export function resetAiTodayLine(): void {
  generatedDays.clear();
  shown = null;
}
