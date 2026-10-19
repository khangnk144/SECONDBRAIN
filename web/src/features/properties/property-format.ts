/** Labels and display values of property chips: "Hạn chót 05/11/2026" (label, space, value). */
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import 'dayjs/locale/en';
import type { TFunction } from 'i18next';
import {
  isIsoDate,
  KNOWN_KEYS,
  STATUS_VALUES,
  TYPE_VALUES,
  wikilinkText,
  type PropertyEntry,
} from './frontmatter-values';

const isKnownKey = (key: string): key is (typeof KNOWN_KEYS)[number] =>
  (KNOWN_KEYS as readonly string[]).includes(key);

export function propertyLabel(t: TFunction, key: string): string {
  return isKnownKey(key) ? t(`properties.labels.${key}`) : key;
}

/** `dd/mm/yyyy` in Vietnamese, `MMM D, YYYY` in English (the pattern lives in the locale files). */
export function formatPropertyDate(t: TFunction, value: string, language: string): string {
  return dayjs(value).locale(language).format(t('properties.dateFormat'));
}

export function statusLabel(t: TFunction, value: string): string {
  return (STATUS_VALUES as readonly string[]).includes(value)
    ? t(`properties.values.status.${value}`)
    : value;
}

export function typeLabel(t: TFunction, value: string): string {
  return (TYPE_VALUES as readonly string[]).includes(value)
    ? t(`properties.values.type.${value}`)
    : value;
}

/** The tags a `tags:` value holds (a list, or a single string). */
export function tagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag) => tag !== null).map(String);
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
  return [];
}

const plain = (value: unknown) => (value === null || value === undefined ? '' : String(value));

export function propertyValueText(t: TFunction, entry: PropertyEntry, language: string): string {
  const { value } = entry;
  switch (entry.kind) {
    case 'date':
      return isIsoDate(value) ? formatPropertyDate(t, value, language) : plain(value);
    case 'status':
      return typeof value === 'string' ? statusLabel(t, value) : plain(value);
    case 'type':
      return typeof value === 'string' ? typeLabel(t, value) : plain(value);
    case 'course':
      return typeof value === 'string' ? wikilinkText(value) : plain(value);
    case 'tags':
      return tagList(value).join(', ');
    case 'list':
      return Array.isArray(value) ? value.map(plain).join(', ') : plain(value);
    case 'complex':
      return entry.yaml ?? '';
    default:
      return plain(value);
  }
}

/**
 * Typed text back into a value: numbers and booleans stay numbers and booleans when the key
 * held one, lists split on commas; everything else is the string as typed.
 */
export function valueFromText(text: string, previous: unknown): unknown {
  const trimmed = text.trim();
  if (Array.isArray(previous)) {
    return trimmed === ''
      ? []
      : trimmed
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
  }
  if (typeof previous === 'number' && trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  if (typeof previous === 'boolean' && (trimmed === 'true' || trimmed === 'false')) {
    return trimmed === 'true';
  }
  return trimmed;
}
