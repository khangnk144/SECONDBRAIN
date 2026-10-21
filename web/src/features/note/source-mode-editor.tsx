import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { transferFiles } from '../../editor/attachments/attachment-files';
import { uploadIntoSource, type SourceUploadTarget } from './source-mode-uploads';

interface SourceModeEditorProps {
  /** The file as text: `\n` line endings, no BOM (they come back on save). */
  text: string;
  readOnly: boolean;
  onChange: (text: string) => void;
}

/**
 * Source mode (F3.8): the raw Markdown of the whole note in a monospace field. Files dropped or
 * pasted here are uploaded like in the editor and their link text goes in at the caret (F15.1).
 */
export const SourceModeEditor = forwardRef<HTMLTextAreaElement, SourceModeEditorProps>(
  function SourceModeEditor({ text, readOnly, onChange }, ref) {
    const { t } = useTranslation();
    const field = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => field.current as HTMLTextAreaElement);
    const latest = useRef({ text, onChange, mounted: true });
    latest.current = { text, onChange, mounted: true };
    const [uploading, setUploading] = useState<ReadonlyMap<number, string>>(new Map());
    const pendingSelection = useRef<[number, number] | null>(null);

    useEffect(
      () => () => {
        latest.current.mounted = false;
      },
      [],
    );
    // A programmatic value change puts the caret at the end; put it back where it belongs.
    useLayoutEffect(() => {
      const selection = pendingSelection.current;
      if (!selection || !field.current) return;
      pendingSelection.current = null;
      field.current.setSelectionRange(selection[0], selection[1]);
    }, [text]);

    const target: SourceUploadTarget = {
      getText: () => (latest.current.mounted ? latest.current.text : null),
      setText: (next, map) => {
        const element = field.current;
        if (element) {
          pendingSelection.current = [map(element.selectionStart), map(element.selectionEnd)];
        }
        latest.current.text = next;
        latest.current.onChange(next);
      },
      setUploading: (id, name) =>
        setUploading((current) => {
          const next = new Map(current);
          if (name === null) next.delete(id);
          else next.set(id, name);
          return next;
        }),
    };

    const takeFiles = (event: DragEvent | ClipboardEvent, data: DataTransfer | null) => {
      const files = transferFiles(data);
      if (files.length === 0) return;
      event.preventDefault();
      if (readOnly || !field.current) return;
      void uploadIntoSource(files, field.current.selectionStart, target);
    };

    return (
      <>
        {uploading.size > 0 ? (
          <ul className="source-editor__uploads" aria-live="polite">
            {[...uploading].map(([id, name]) => (
              <li key={id}>{t('attachments.uploading', { name })}</li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={field}
          className="source-editor"
          value={text}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          aria-label={t('note.source.label')}
          onChange={(event) => onChange(event.target.value)}
          onDragOver={(event) => {
            // Without this the browser opens a dragged file instead of dropping it here.
            if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
          }}
          onDrop={(event) => takeFiles(event, event.dataTransfer)}
          onPaste={(event) => takeFiles(event, event.clipboardData)}
        />
      </>
    );
  },
);
