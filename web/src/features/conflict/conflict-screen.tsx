import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConflictVersions } from '../note-session/note-session-types';
import { ConflictDiffView } from './conflict-diff-view';
import { ConflictVersionTabs } from './conflict-versions';
import './conflict-screen.css';

interface ConflictScreenProps {
  conflict: ConflictVersions;
  /** An action is on its way: the buttons wait. */
  busy: boolean;
  onReload: () => void;
  onKeepMine: () => void;
  /** Looking at a set-aside version: go back without deciding. */
  onClose: () => void;
}

/**
 * The note changed elsewhere while it had unsaved edits (SPEC §4.10): three versions, and the
 * choice between "Tải lại", "Giữ bản của tôi" and "So sánh". Nothing is lost either way.
 */
export function ConflictScreen(props: ConflictScreenProps) {
  const { conflict, busy, onReload, onKeepMine, onClose } = props;
  const { t } = useTranslation();
  const kept = conflict.keptId !== undefined;
  // A set-aside version opens on the comparison: that is what the owner came to see.
  const [comparing, setComparing] = useState(kept);
  const heading = useRef<HTMLHeadingElement>(null);
  const deleted = conflict.disk === null;
  const title = kept ? 'conflict.kept.title' : deleted ? 'conflict.titleDeleted' : 'conflict.title';
  const body = kept ? 'conflict.kept.body' : deleted ? 'conflict.bodyDeleted' : 'conflict.body';
  const diskText = conflict.disk?.text ?? null;

  // The editor just became read-only: bring keyboard users to the choice.
  useEffect(() => heading.current?.focus(), []);

  return (
    <section className="conflict-screen" aria-labelledby="conflict-title">
      <h2 id="conflict-title" ref={heading} tabIndex={-1} className="conflict-screen__title">
        {t(title)}
      </h2>
      <p className="conflict-screen__body">{t(body)}</p>
      <div className="conflict-screen__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={busy}
          onClick={onReload}
        >
          {t(kept ? 'conflict.kept.discard' : 'conflict.actions.reload')}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={onKeepMine}
        >
          {t(kept ? 'conflict.kept.restore' : 'conflict.actions.keepMine')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-pressed={comparing}
          disabled={diskText === null}
          onClick={() => setComparing((was) => !was)}
        >
          {t('conflict.actions.compare')}
        </button>
        {kept ? (
          <button type="button" className="button button--secondary" onClick={onClose}>
            {t('conflict.kept.close')}
          </button>
        ) : null}
      </div>
      {kept ? null : (
        <ul className="conflict-screen__hints text-small">
          <li>{t(deleted ? 'conflict.hints.reloadDeleted' : 'conflict.hints.reload')}</li>
          <li>{t(deleted ? 'conflict.hints.keepMineDeleted' : 'conflict.hints.keepMine')}</li>
        </ul>
      )}
      {comparing && diskText !== null ? (
        <ConflictDiffView disk={diskText} mine={conflict.mine} />
      ) : (
        <ConflictVersionTabs conflict={conflict} />
      )}
    </section>
  );
}
