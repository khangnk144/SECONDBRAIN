import { useTranslation } from 'react-i18next';
import { aiProviderName } from '../../lib/ai-provider-name';
import type { SettingsResponse } from '../../lib/api/settings-types';
import { useAiFolders, useFolderLabel } from './ai-folder-scope';
import { excludedLeftOut } from './ai-scope-folders';
import { ConsentDialog } from './consent-dialog';
import { formatList, formatTokens } from './settings-format';
import type { SaveState } from './use-setting-save';

type AiSettings = SettingsResponse['ai'];

interface ConsentProps {
  ai: AiSettings;
  state: SaveState;
  onAgree: () => void;
  onLater: () => void;
}

/** The chosen folders as one phrase ("Ghi chú ở gốc kho, 0 Inbox, 1 Projects"). */
function useFolderPhrase(ai: AiSettings): { phrase: string; chosen: string[] } {
  const { t } = useTranslation();
  const { chosen } = useAiFolders(ai.folders);
  const label = useFolderLabel();
  const phrase = chosen.length === 0 ? t('settings.ai.foldersNone') : chosen.map(label).join(', ');
  return { phrase, chosen };
}

/**
 * Turning AI on: what goes to which provider (questions with the conversation so far, excerpts,
 * names, selections, a whole Inbox note for tidying), what never leaves, the limit, and that
 * answers can be wrong and do not always cite.
 */
export function ChatConsentDialog({ ai, state, onAgree, onLater }: ConsentProps) {
  const { t, i18n } = useTranslation();
  const provider = aiProviderName(ai.provider, t);
  const { phrase, chosen } = useFolderPhrase(ai);
  const leftOut = excludedLeftOut(chosen);
  const never = [
    t('settings.ai.consent.neverOutside'),
    ...(leftOut.length > 0
      ? [t('settings.ai.consent.neverExcluded', { folders: formatList(leftOut, i18n.language) })]
      : []),
    t('settings.ai.consent.neverFiles'),
    t('settings.ai.consent.neverKey', { provider }),
  ];
  return (
    <ConsentDialog
      title={t('settings.ai.consent.title', { provider })}
      lead={t('settings.ai.consent.lead', { provider })}
      lists={[
        {
          label: t('settings.ai.consent.sentLabel'),
          items: [
            t('settings.ai.consent.sentQuestion'),
            t('settings.ai.consent.sentExcerpts', { folders: phrase }),
            t('settings.ai.consent.sentNames'),
            t('settings.ai.consent.sentSelection'),
            t('settings.ai.consent.sentInbox'),
          ],
        },
        { label: t('settings.ai.consent.neverLabel'), items: never },
      ]}
      notes={[
        t('settings.ai.consent.limit', {
          limit: formatTokens(ai.monthlyTokenLimit, i18n.language),
        }),
        t('settings.ai.consent.wrong'),
      ]}
      agreeLabel={t('settings.ai.consent.agree')}
      laterLabel={t('settings.ai.consent.later')}
      state={state}
      onAgree={onAgree}
      onLater={onLater}
    />
  );
}

/** Turning embeddings on: every in-scope note's text goes, little by little, to that provider. */
export function EmbeddingsConsentDialog({ ai, state, onAgree, onLater }: ConsentProps) {
  const { t } = useTranslation();
  const provider = aiProviderName(ai.embeddingProvider, t);
  const { phrase } = useFolderPhrase(ai);
  const text = (key: string) => t(`settings.ai.embeddings.consent.${key}`, { provider });
  return (
    <ConsentDialog
      title={text('title')}
      lead={t('settings.ai.embeddings.consent.lead', { provider, folders: phrase })}
      notes={[text('edits'), text('search'), text('cost'), text('never'), text('off')]}
      agreeLabel={text('agree')}
      laterLabel={text('later')}
      state={state}
      onAgree={onAgree}
      onLater={onLater}
    />
  );
}
