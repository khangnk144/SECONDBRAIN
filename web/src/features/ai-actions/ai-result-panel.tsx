import { Sparkle, X } from '@phosphor-icons/react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MarkdownEditorHandle } from '../../editor/editor-handle';
import type { AiLinkSuggestions } from '../../lib/api/ai-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { showToast } from '../../lib/toast-store';
import type { NoteSession } from '../note-session/note-session';
import { aiActionLabelKey } from './ai-action-kinds';
import { AiPanelBlocked, AiPanelError, AiPanelLoading } from './ai-panel-messages';
import { AiLinkSuggestionList, AiTagSuggestionList } from './ai-suggestion-lists';
import { AiTextResult } from './ai-text-result';
import {
  addTagsToNote,
  aiQuoteMarkdown,
  insertLinksBelow,
  insertMarkdownBelow,
  linkTargetFor,
  replaceSelection,
  type ApplyOutcome,
} from './apply-ai-result';
import type { AiPanelController, PanelState } from './use-ai-action-panel';
import './ai-actions.css';

const EDGE_PX = 16;

interface AiResultPanelProps {
  controller: AiPanelController;
  state: PanelState;
  handle: MarkdownEditorHandle | null;
  session: NoteSession;
}

/** Keeps the panel inside the viewport (below the selection when there is room). */
function usePlacement(state: PanelState) {
  const ref = useRef<HTMLElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(state.anchor);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel || !state.anchor) return;
    const rect = panel.getBoundingClientRect();
    setPlace({
      left: Math.max(
        EDGE_PX,
        Math.min(state.anchor.left, window.innerWidth - rect.width - EDGE_PX),
      ),
      top: Math.max(
        EDGE_PX,
        Math.min(state.anchor.top, window.innerHeight - rect.height - EDGE_PX),
      ),
    });
  }, [state.anchor, state.phase.kind]);
  return { ref, place };
}

/**
 * The AI result for a selection (SPEC F33 editor actions): a non-modal popover below the
 * selection (a sheet at the bottom on narrow screens). The result is labelled "AI đề xuất" and
 * nothing in the note changes until she chooses an action. Esc closes it (and aborts).
 */
export function AiResultPanel({ controller, state, handle, session }: AiResultPanelProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const status = useAiStatusStore((store) => store.status);
  const { ref, place } = usePlacement(state);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => controller.close();
  const leave = () => controller.close({ focusEditor: false });

  // Focus follows the panel's step: the first action of each new state (keyboard flow).
  useEffect(() => {
    setNotice(null);
    const panel = ref.current;
    const target =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>('button');
    target?.focus();
  }, [ref, state.id, state.phase.kind]);

  const done = (outcome: ApplyOutcome) => {
    if (outcome === 'stale') setNotice(t('ai-actions.panel.stale'));
    else if (outcome === 'done') controller.close({ focusEditor: false });
  };
  const tracker = controller.tracker();
  const insertText = (text: string) => {
    if (!handle || !tracker) return done('stale');
    const label =
      state.action === 'summarize'
        ? t('ai-actions.panel.summaryLabel')
        : state.action === 'explain'
          ? t('ai-actions.panel.explainLabel')
          : null;
    done(insertMarkdownBelow(handle, tracker, label ? aiQuoteMarkdown(label, text) : text));
  };
  const replace = (text: string) =>
    done(handle && tracker ? replaceSelection(handle, tracker, text) : 'stale');
  const addLinks = (links: AiLinkSuggestions['links']) => {
    if (!handle || !tracker) return done('stale');
    const from: VaultPath = session.path();
    const targets = links.map((link) => linkTargetFor(link.path, link.title, from));
    done(insertLinksBelow(handle, tracker, t('ai-actions.links.paragraphLabel'), targets));
  };
  const addTags = async (tags: string[]) => {
    setBusy(true);
    const outcome = await addTagsToNote(session, tags);
    setBusy(false);
    if (outcome.kind === 'added') {
      showToast({ message: t('ai-actions.tags.added', { count: outcome.count }) });
      controller.close();
    } else {
      setNotice(t(`ai-actions.tags.${outcome.kind}`));
    }
  };

  const { phase } = state;
  const body = (() => {
    switch (phase.kind) {
      case 'loading':
        return <AiPanelLoading action={state.action} status={status} onClose={close} />;
      case 'blocked':
        return (
          <AiPanelBlocked blocker={phase.blocker} status={status} onClose={close} onLeave={leave} />
        );
      case 'error':
        return (
          <AiPanelError
            error={phase.error}
            status={status}
            onRetry={controller.retry}
            onClose={close}
            onLeave={leave}
          />
        );
      case 'text':
        return (
          <AiTextResult
            action={state.action}
            text={phase.text}
            selection={state.markdown}
            onInsertBelow={() => insertText(phase.text)}
            onReplace={() => replace(phase.text)}
          />
        );
      case 'links':
        return <AiLinkSuggestionList links={phase.links} onAdd={addLinks} onClose={close} />;
      case 'tags':
        return (
          <AiTagSuggestionList
            tags={phase.tags}
            busy={busy}
            onAdd={(tags) => void addTags(tags)}
            onClose={close}
          />
        );
    }
  })();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    <section
      ref={ref}
      className="ai-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-anchored={place ? true : undefined}
      style={place ? { left: place.left, top: place.top } : undefined}
      onKeyDown={onKeyDown}
    >
      <header className="ai-panel__header">
        <Sparkle size={18} aria-hidden="true" className="ai-panel__icon" />
        <h2 id={titleId} className="ai-panel__title">
          {t(aiActionLabelKey(state.action))}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t('ai-actions.panel.close')}
          onClick={close}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {body}
      {notice ? (
        <p role="alert" className="ai-panel__notice">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
