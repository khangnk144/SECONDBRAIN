import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiStatus } from '../../lib/api/ai-types';
import { MAX_MONTHLY_TOKEN_LIMIT, MIN_MONTHLY_TOKEN_LIMIT } from '../../lib/api/settings-types';
import { SaveStatus } from './save-status';
import { SettingsField } from './settings-section';
import { formatTokens, nextMonthLabel, parseTokenCount } from './settings-format';
import { useSettingSave } from './use-setting-save';

/** A limit she may type, or null (the server takes the same range). */
export function parseMonthlyLimit(text: string): number | null {
  const value = parseTokenCount(text);
  return value !== null && value >= MIN_MONTHLY_TOKEN_LIMIT && value <= MAX_MONTHLY_TOKEN_LIMIT
    ? value
    : null;
}

/**
 * "Hạn mức mỗi tháng (token)" (SPEC F33 cost cap): saved on blur or Enter, with this month's use
 * below and, once it is used up, what is paused and how to go on.
 */
export function AiBudgetField({ limit, status }: { limit: number; status: AiStatus | null }) {
  const { t, i18n } = useTranslation();
  const { state, save, fail, clear } = useSettingSave();
  const language = i18n.language;
  const stored = formatTokens(limit, language);
  const [draft, setDraft] = useState(stored);
  useLayoutEffect(() => setDraft(stored), [stored]);
  const commit = () => {
    if (draft.trim() === stored) return;
    const value = parseMonthlyLimit(draft);
    if (value === null) {
      fail(
        t('settings.ai.budget.invalid', {
          min: formatTokens(MIN_MONTHLY_TOKEN_LIMIT, language),
          max: formatTokens(MAX_MONTHLY_TOKEN_LIMIT, language),
        }),
      );
      return;
    }
    if (value === limit) setDraft(stored);
    else void save({ ai: { monthlyTokenLimit: value } });
  };
  const usage = status?.available ? status.usage : null;
  return (
    <SettingsField
      label={t('settings.ai.budget.label')}
      htmlFor="settings-ai-budget"
      status={<SaveStatus state={state} id="settings-ai-budget-status" />}
      hint={
        <>
          {usage ? (
            <p>
              {t('settings.ai.budget.usage', {
                used: formatTokens(usage.tokens, language),
                limit: formatTokens(limit, language),
              })}
            </p>
          ) : null}
          <p>{t('settings.ai.budget.explain')}</p>
          {usage?.paused ? (
            <p className="settings-field__notice" role="status">
              {t('settings.ai.budget.paused', {
                limit: formatTokens(usage.limit, language),
                next: nextMonthLabel(usage.month, language),
              })}
            </p>
          ) : null}
        </>
      }
    >
      <input
        id="settings-ai-budget"
        className="text-input settings-input--budget"
        inputMode="numeric"
        value={draft}
        autoComplete="off"
        aria-describedby="settings-ai-budget-status"
        aria-invalid={state.kind === 'error' || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft(stored);
            clear();
          }
        }}
      />
    </SettingsField>
  );
}
