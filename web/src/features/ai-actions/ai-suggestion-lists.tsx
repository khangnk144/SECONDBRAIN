import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLinkSuggestions, AiTagSuggestions } from '../../lib/api/ai-types';
import { parentFolder } from '../../lib/vault-paths';
import { AiProposalLabel } from './ai-text-result';

/** Checked state of a proposal list: everything starts checked, nothing is applied by it. */
function useChecked(count: number) {
  const [checked, setChecked] = useState<boolean[]>(() =>
    Array.from({ length: count }, () => true),
  );
  const toggle = (index: number) =>
    setChecked((current) => current.map((value, i) => (i === index ? !value : value)));
  return { checked, toggle };
}

interface LinkSuggestionsProps {
  links: AiLinkSuggestions['links'];
  onAdd: (links: AiLinkSuggestions['links']) => void;
  onClose: () => void;
}

/** "Gợi ý liên kết": title, folder and reason per note; "Thêm liên kết" adds the checked ones. */
export function AiLinkSuggestionList({ links, onAdd, onClose }: LinkSuggestionsProps) {
  const { t } = useTranslation();
  const id = useId();
  const { checked, toggle } = useChecked(links.length);
  if (links.length === 0)
    return <EmptyProposal text={t('ai-actions.links.empty')} onClose={onClose} />;
  const chosen = links.filter((_, index) => checked[index]);
  return (
    <>
      <AiProposalLabel />
      <ul className="ai-panel__choices" aria-label={t('ai-actions.links.listLabel')}>
        {links.map((link, index) => {
          const folder = parentFolder(link.path);
          return (
            <li key={link.path}>
              <label className="ai-panel__choice" htmlFor={`${id}-${index}`}>
                <input
                  id={`${id}-${index}`}
                  type="checkbox"
                  checked={checked[index] ?? false}
                  onChange={() => toggle(index)}
                />
                <span className="ai-panel__choice-text">
                  <span className="ai-panel__choice-title">{link.title}</span>{' '}
                  <span className="ai-panel__choice-meta">
                    {folder === '' ? t('ai-actions.links.rootFolder') : folder}
                  </span>{' '}
                  {link.reason ? (
                    <span className="ai-panel__choice-reason">{link.reason}</span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="ai-panel__actions">
        <button
          type="button"
          className="button button--primary"
          data-autofocus
          aria-disabled={chosen.length === 0 || undefined}
          onClick={() => {
            if (chosen.length > 0) onAdd(chosen);
          }}
        >
          {t('ai-actions.links.add')}
        </button>
      </div>
    </>
  );
}

interface TagSuggestionsProps {
  tags: AiTagSuggestions['tags'];
  busy: boolean;
  onAdd: (tags: string[]) => void;
  onClose: () => void;
}

/** "Gợi ý thẻ": tags the vault does not use yet are marked "mới"; "Thêm thẻ" adds the checked. */
export function AiTagSuggestionList({ tags, busy, onAdd, onClose }: TagSuggestionsProps) {
  const { t } = useTranslation();
  const id = useId();
  const { checked, toggle } = useChecked(tags.length);
  if (tags.length === 0)
    return <EmptyProposal text={t('ai-actions.tags.empty')} onClose={onClose} />;
  const chosen = tags.filter((_, index) => checked[index]).map((tag) => tag.tag);
  const disabled = busy || chosen.length === 0;
  return (
    <>
      <AiProposalLabel />
      <ul className="ai-panel__choices" aria-label={t('ai-actions.tags.listLabel')}>
        {tags.map((tag, index) => (
          <li key={tag.tag}>
            <label className="ai-panel__choice" htmlFor={`${id}-${index}`}>
              <input
                id={`${id}-${index}`}
                type="checkbox"
                checked={checked[index] ?? false}
                onChange={() => toggle(index)}
              />
              <span className="ai-panel__tag">#{tag.tag}</span>{' '}
              {tag.existing ? null : (
                <span className="ai-panel__new">{t('ai-actions.tags.new')}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      <div className="ai-panel__actions">
        <button
          type="button"
          className="button button--primary"
          data-autofocus
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) onAdd(chosen);
          }}
        >
          {t('ai-actions.tags.add')}
        </button>
      </div>
    </>
  );
}

function EmptyProposal({ text, onClose }: { text: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <p role="status" className="ai-panel__message">
        {text}
      </p>
      <div className="ai-panel__actions">
        <button type="button" className="button button--secondary" data-autofocus onClick={onClose}>
          {t('ai-actions.panel.close')}
        </button>
      </div>
    </>
  );
}
