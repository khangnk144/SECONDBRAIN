import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../lib/api-client';
import { getNoteMentions, postLinkMention } from '../../lib/api/notes-api';
import type { MentionRef } from '../../lib/api/notes-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { debounce } from '../../lib/debounce';
import { showOperationError } from '../../lib/operation-errors';
import { showToast } from '../../lib/toast-store';
import { useServerEvent } from '../../lib/ws/use-server-event';
import { isVaultChange, PANEL_REFRESH_MS } from '../backlinks/use-panel-note';

export type MentionsState =
  | { status: 'idle' }
  | { status: 'loading'; path: VaultPath }
  | { status: 'ready'; path: VaultPath; mentions: MentionRef[] }
  | { status: 'error'; path: VaultPath };

export const mentionKey = (mention: MentionRef) =>
  `${mention.path}:${mention.start}:${mention.end}`;

/**
 * Unlinked mentions of `path`, fetched only while `active` (the section is open) and refreshed
 * on vault changes. `link` wraps one mention at the revision it was listed with; when the note
 * changed meanwhile (409/400) the list is reloaded and the user told why.
 */
export function useUnlinkedMentions(
  path: VaultPath | null,
  active: boolean,
  onLinked?: () => void,
) {
  const { t } = useTranslation();
  const [state, setState] = useState<MentionsState>({ status: 'idle' });
  const [linking, setLinking] = useState<string | null>(null);
  const latest = useRef({ path, active });
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const { path: target, active: on } = latest.current;
    if (!target || !on) return;
    const id = ++sequence.current;
    try {
      const { mentions } = await getNoteMentions(target);
      if (id === sequence.current) setState({ status: 'ready', path: target, mentions });
    } catch {
      if (id !== sequence.current) return;
      setState((previous) =>
        previous.status === 'ready' && previous.path === target
          ? previous
          : { status: 'error', path: target },
      );
    }
  }, []);

  useEffect(() => {
    latest.current = { path, active };
    if (!path || !active) return;
    // Keep the list of this note on screen while it refreshes; never show another note's list.
    setState((previous) =>
      previous.status !== 'idle' && previous.path === path ? previous : { status: 'loading', path },
    );
    void load();
  }, [path, active, load]);

  const refresh = useMemo(() => debounce(() => void load(), PANEL_REFRESH_MS), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useServerEvent('*', (event) => {
    if (latest.current.active && isVaultChange(event)) refresh.schedule();
  });

  const busy = useRef(false);
  const link = useCallback(
    async (mention: MentionRef) => {
      const target = latest.current.path;
      // One patch at a time: the next one needs the revisions the reload brings.
      if (!target || busy.current) return;
      busy.current = true;
      setLinking(mentionKey(mention));
      try {
        await postLinkMention({
          path: mention.path,
          expectedRevision: mention.revision,
          start: mention.start,
          end: mention.end,
          target,
        });
        showToast({ message: t('backlinks.mentions.linked', { title: mention.title }) });
        onLinked?.();
      } catch (error) {
        // The note was edited since the list was made: the offsets no longer hold.
        if (isApiError(error) && (error.status === 409 || error.status === 400)) {
          showToast({ message: t('backlinks.mentions.changed') });
        } else {
          showOperationError(error);
        }
      } finally {
        await load();
        busy.current = false;
        setLinking(null);
      }
    },
    [load, onLinked, t],
  );

  return { state, linking, link };
}
