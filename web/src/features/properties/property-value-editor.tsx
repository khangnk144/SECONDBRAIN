import { useTranslation } from 'react-i18next';
import { ChoiceList } from './choice-list';
import { isIsoDate, STATUS_VALUES, TYPE_VALUES, type PropertyEntry } from './frontmatter-values';
import { NotePicker } from './note-picker';
import { statusLabel, tagList, typeLabel, valueFromText } from './property-format';
import { TagsEditor } from './tags-editor';
import { TextValueForm } from './text-value-form';

interface PropertyValueEditorProps {
  entry: PropertyEntry;
  label: string;
  /** Saves the new value; `close` says whether the popover is done (tags stay open). */
  onCommit: (value: unknown, close: boolean) => void;
}

/** The editor that fits the property: date picker, select, note picker, tag chips or text. */
export function PropertyValueEditor({ entry, label, onCommit }: PropertyValueEditorProps) {
  const { t } = useTranslation();
  const { value } = entry;
  switch (entry.kind) {
    case 'date':
      return (
        <TextValueForm
          label={label}
          inputType="date"
          initial={isIsoDate(value) ? value : ''}
          onSubmit={(text) => onCommit(text.trim() === '' ? null : text, true)}
        />
      );
    case 'status':
      return (
        <ChoiceList
          label={label}
          current={value}
          options={STATUS_VALUES.map((v) => ({ value: v, label: statusLabel(t, v) }))}
          onPick={(picked) => onCommit(picked, true)}
        />
      );
    case 'type':
      return (
        <ChoiceList
          label={label}
          current={value}
          options={TYPE_VALUES.map((v) => ({ value: v, label: typeLabel(t, v) }))}
          onPick={(picked) => onCommit(picked, true)}
        />
      );
    case 'course':
      return <NotePicker label={label} onPick={(link) => onCommit(link, true)} />;
    case 'tags':
      return (
        <TagsEditor
          label={t('properties.addTagLabel')}
          tags={tagList(value)}
          onChange={(tags) => onCommit(tags.length > 0 ? tags : null, false)}
        />
      );
    case 'list':
      return (
        <TextValueForm
          label={label}
          initial={Array.isArray(value) ? value.join(', ') : ''}
          hint={t('properties.listHint')}
          onSubmit={(text) => onCommit(valueFromText(text, value), true)}
        />
      );
    case 'complex':
      return <p className="text-small">{t('properties.complexValue')}</p>;
    default:
      return (
        <TextValueForm
          label={label}
          initial={value === null || value === undefined ? '' : String(value)}
          onSubmit={(text) => onCommit(valueFromText(text, value), true)}
        />
      );
  }
}
