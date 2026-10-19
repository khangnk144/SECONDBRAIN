import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

interface SourceModeEditorProps {
  /** The file as text: `\n` line endings, no BOM (they come back on save). */
  text: string;
  readOnly: boolean;
  onChange: (text: string) => void;
}

/** Source mode (F3.8): the raw Markdown of the whole note in a monospace field. */
export const SourceModeEditor = forwardRef<HTMLTextAreaElement, SourceModeEditorProps>(
  function SourceModeEditor({ text, readOnly, onChange }, ref) {
    const { t } = useTranslation();
    return (
      <textarea
        ref={ref}
        className="source-editor"
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        aria-label={t('note.source.label')}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
);
