import { CaretRight } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMcpConfig } from '../../lib/api/mcp-api';
import type { McpConfig } from '../../lib/api/mcp-types';
import { maskBearerTokens } from './copy-text';
import { SaveStatus } from './save-status';
import { SettingsSection } from './settings-section';
import { SnippetBlock } from './snippet-block';
import { useSettingSave } from './use-setting-save';

const STEPS = ['install', 'config', 'paste', 'restart', 'try'] as const;

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; config: McpConfig };

/** "Cho phép AI sửa ghi chú cá nhân" (SPEC F32 permissions; off by default). */
function NoteEditsSwitch({ allowed }: { allowed: boolean }) {
  const { t } = useTranslation();
  const { state, save } = useSettingSave();
  return (
    <div className="settings-field">
      <div className="settings-field__control">
        <label className="settings-switch">
          <input
            type="checkbox"
            role="switch"
            checked={allowed}
            aria-describedby="settings-mcp-note-edits-hint"
            onChange={(event) => {
              // Not disabled while saving: a disabled switch would drop the keyboard focus.
              if (state.kind !== 'saving')
                void save({ mcp: { allowNoteEdits: event.target.checked } });
            }}
          />
          <span>{t('settings.mcp.noteEdits')}</span>
        </label>
        <SaveStatus state={state} />
      </div>
      <p id="settings-mcp-note-edits-hint" className="settings-field__hint">
        {t('settings.mcp.noteEditsHint')}
      </p>
    </div>
  );
}

function McpSnippets({ config }: { config: McpConfig }) {
  const { t } = useTranslation();
  return (
    <>
      <SnippetBlock
        label={t('settings.mcp.snippetLabel')}
        shown={config.stdioSnippet}
        full={config.stdioSnippet}
        failedText={t('settings.mcp.copyFailed')}
      />
      {config.bridgeBuilt ? null : (
        <p className="settings-field__hint settings-field__notice">
          {t('settings.mcp.bridgeMissing')}
        </p>
      )}
      <details className="settings-details">
        <summary>
          {/* Says "this opens": the summary has no native marker as a flex box. */}
          <CaretRight size={16} aria-hidden="true" className="settings-details__caret" />
          {t('settings.mcp.httpTitle')}
        </summary>
        <div className="settings-details__body">
          <p className="settings-field__hint">{t('settings.mcp.httpIntro')}</p>
          <SnippetBlock
            label={t('settings.mcp.httpSnippetLabel')}
            shown={maskBearerTokens(config.httpSnippet)}
            full={config.httpSnippet}
            failedText={t('settings.mcp.copyFailedMasked')}
          />
          <p className="settings-field__hint settings-field__notice">
            {t('settings.mcp.httpWarning')}
          </p>
        </div>
      </details>
    </>
  );
}

/**
 * "Kết nối Claude (MCP)" (route A, SPEC F18, F32): her Claude subscription works through Claude
 * Desktop, which reaches the vault through this app. The stdio snippet is the guaranteed path;
 * the HTTP one is tucked away and never shows its token in full.
 */
export function McpSection({ allowNoteEdits }: { allowNoteEdits: boolean }) {
  const { t } = useTranslation();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const fetchConfig = useCallback(() => {
    let live = true;
    setLoad({ kind: 'loading' });
    getMcpConfig()
      .then((config) => live && setLoad({ kind: 'ready', config }))
      .catch(() => live && setLoad({ kind: 'error' }));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => fetchConfig(), [fetchConfig]);

  return (
    <SettingsSection id="mcp" title={t('settings.mcp.title')} intro={t('settings.mcp.intro')}>
      <div className="settings-field">
        <p id="settings-mcp-steps" className="settings-field__label">
          {t('settings.mcp.stepsLabel')}
        </p>
        <ol className="settings-steps" aria-labelledby="settings-mcp-steps">
          {STEPS.map((step) => (
            <li key={step}>{t(`settings.mcp.steps.${step}`)}</li>
          ))}
        </ol>
      </div>
      {load.kind === 'ready' ? (
        <McpSnippets config={load.config} />
      ) : load.kind === 'error' ? (
        <div className="settings-field">
          <p className="settings-status settings-status--error" role="alert">
            {t('settings.mcp.loadError')}
          </p>
          <div className="settings-field__control">
            <button type="button" className="button button--secondary" onClick={fetchConfig}>
              {t('settings.mcp.retry')}
            </button>
          </div>
        </div>
      ) : (
        <p className="settings-field__hint">{t('settings.mcp.loading')}</p>
      )}
      <NoteEditsSwitch allowed={allowNoteEdits} />
    </SettingsSection>
  );
}
