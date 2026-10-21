import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { navigateTo, noteRoute } from '../../lib/app-navigation';
import { retryVaultBoot } from '../../lib/vault-boot';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { useVaultStore } from '../../lib/vault-store';
import { useNoteSession } from '../note-session/use-note-session';
import { NoteView } from './note-view';
import './note-screen.css';

/**
 * `#/note?path=<encoded>` (`&new=1` after creation selects the title, `&line=N` scrolls to that
 * file line, `&cursor=N` puts the caret at that file offset). The note's session lives outside
 * React; this screen shows it.
 */
export function NoteScreen() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const location = useLocation();
  const path = params.get('path');
  const { session, view, moved } = useNoteSession(path);
  // Started before the server: no vault yet, so no session; say so instead of "opening…".
  const vaultUnknown = useVaultStore((state) => state.vaultId === null && state.failed);
  const movedTo = moved ? view?.path : undefined;

  // Renamed while open and the address still names the old path: follow the note.
  useEffect(() => {
    if (movedTo) navigateTo(noteRoute(movedTo), { replace: true });
  }, [movedTo]);

  if (!path) return <p className="note-screen__message">{t('note.missingPath')}</p>;
  const current = session && view ? { session, view } : null;
  const loadProblem = current?.view.loadProblem ?? (vaultUnknown ? 'failed' : null);
  if (loadProblem) {
    return (
      <article className="note-screen" aria-labelledby="note-missing-title">
        <h1 id="note-missing-title" className="text-display note-screen__static-title">
          {noteTitleFromPath(path)}
        </h1>
        <p className="note-screen__message" role="alert">
          {t(loadProblem === 'not-found' ? 'note.notFound' : 'note.loadFailed')}
        </p>
        {loadProblem === 'failed' ? (
          <button
            type="button"
            className="button button--secondary note-screen__retry"
            onClick={() => (current ? current.session.retryOpen() : retryVaultBoot())}
          >
            {t('note.retryOpen')}
          </button>
        ) : null}
      </article>
    );
  }
  if (!current || current.view.status === 'loading' || !current.view.doc) {
    return (
      <article className="note-screen" aria-busy="true" aria-labelledby="note-loading-title">
        <h1 id="note-loading-title" className="text-display note-screen__static-title">
          {noteTitleFromPath(path)}
        </h1>
        <p className="note-screen__message" role="status">
          {t('note.loading')}
        </p>
      </article>
    );
  }
  return (
    <NoteView
      key={current.session.id}
      session={current.session}
      view={current.view}
      isNew={params.get('new') === '1'}
      line={Number(params.get('line')) || null}
      lineRequest={location.key}
      cursor={cursorParam(params.get('cursor'))}
    />
  );
}

function cursorParam(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : null;
}
