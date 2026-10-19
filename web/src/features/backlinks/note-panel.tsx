import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MentionsSection } from '../mentions/mentions-section';
import { OutlineSection } from '../outline/outline-section';
import { BacklinksSection } from './backlinks-section';
import { usePanelNote } from './use-panel-note';
import './note-panel.css';

type SectionId = 'outline' | 'linked' | 'mentions';

/**
 * Right panel of the note route (design.md screen 2): outline, backlinks and unlinked mentions
 * of the note in `?path=`. Mentions start collapsed because they cost a scan of other notes.
 */
export function NotePanel() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const path = params.get('path');
  const { state, reload } = usePanelNote(path);
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    outline: true,
    linked: true,
    mentions: false,
  });
  const toggle = (id: SectionId) => () =>
    setExpanded((current) => ({ ...current, [id]: !current[id] }));

  if (!path) return null;
  const note = state.status === 'ready' ? state.note : null;
  const loading = state.status === 'loading';

  return (
    <div className="note-panel">
      {state.status === 'error' ? (
        <div className="note-panel__error">
          <p role="alert">{t(state.notFound ? 'backlinks.notFound' : 'backlinks.loadError')}</p>
          {state.notFound ? null : (
            <button type="button" className="note-panel__retry" onClick={() => void reload()}>
              {t('backlinks.retry')}
            </button>
          )}
        </div>
      ) : null}
      <OutlineSection
        path={path}
        content={note?.content ?? null}
        loading={loading}
        expanded={expanded.outline}
        onToggle={toggle('outline')}
      />
      <BacklinksSection
        path={path}
        backlinks={note?.backlinks ?? null}
        loading={loading}
        expanded={expanded.linked}
        onToggle={toggle('linked')}
      />
      <MentionsSection
        path={path}
        expanded={expanded.mentions}
        onToggle={toggle('mentions')}
        onLinked={() => void reload()}
      />
    </div>
  );
}
