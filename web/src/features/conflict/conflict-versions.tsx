import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConflictVersions } from '../note-session/note-session-types';
import { displayLines } from './line-diff';

type VersionId = 'base' | 'disk' | 'mine';
const ORDER: VersionId[] = ['base', 'disk', 'mine'];

function versionText(conflict: ConflictVersions, id: VersionId): string | null {
  if (id === 'base') return conflict.base;
  if (id === 'disk') return conflict.disk?.text ?? null;
  return conflict.mine;
}

function missingKey(conflict: ConflictVersions, id: VersionId): string {
  if (id === 'base') return 'conflict.versions.baseUnknown';
  return conflict.disk === null ? 'conflict.versions.diskDeleted' : 'conflict.versions.diskNotText';
}

/** The three versions of SPEC §4.10 as tabs (arrow keys move between them). */
export function ConflictVersionTabs({ conflict }: { conflict: ConflictVersions }) {
  const { t } = useTranslation();
  const id = useId();
  const [selected, setSelected] = useState<VersionId>('mine');
  const tabs = useRef<Record<VersionId, HTMLButtonElement | null>>({
    base: null,
    disk: null,
    mine: null,
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const jump = event.key === 'Home' ? 'base' : event.key === 'End' ? 'mine' : null;
    if (step === 0 && jump === null) return;
    event.preventDefault();
    const next = jump ?? ORDER[(ORDER.indexOf(selected) + step + ORDER.length) % ORDER.length];
    if (!next) return;
    setSelected(next);
    tabs.current[next]?.focus();
  };

  const text = versionText(conflict, selected);
  return (
    <div className="conflict-versions">
      <div
        role="tablist"
        aria-label={t('conflict.versions.label')}
        className="conflict-versions__tabs"
        onKeyDown={onKeyDown}
      >
        {ORDER.map((version) => (
          <button
            key={version}
            ref={(element) => {
              tabs.current[version] = element;
            }}
            id={`${id}-${version}-tab`}
            type="button"
            role="tab"
            aria-selected={selected === version}
            aria-controls={`${id}-panel`}
            tabIndex={selected === version ? 0 : -1}
            className="conflict-versions__tab"
            onClick={() => setSelected(version)}
          >
            {t(`conflict.versions.${version}`)}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${selected}-tab`}
        tabIndex={0}
        className="conflict-versions__panel"
      >
        {text === null ? (
          <p className="text-small">{t(missingKey(conflict, selected))}</p>
        ) : (
          <pre className="conflict-versions__text">{displayLines(text).join('\n')}</pre>
        )}
      </div>
    </div>
  );
}
