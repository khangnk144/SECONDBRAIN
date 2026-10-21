/**
 * A compact card for an embedded file that is not shown inline (`![[bài giảng 3.pdf]]`): file
 * icon, name, kind and "Mở". Plain DOM for node views. Files are opened through `openVaultFile`
 * (the viewer decides: PDF in the app, everything else outside the app origin).
 */
import { i18n } from '../../i18n';
import { createInlineIcon, type InlineIconName } from '../inline-icons';
import { fileExtension } from './attachment-files';

type CardKind = 'pdf' | 'slides' | 'document' | 'sheet' | 'web' | 'image' | 'other';

const KIND_BY_EXTENSION: Record<string, CardKind> = {
  pdf: 'pdf',
  ppt: 'slides',
  pptx: 'slides',
  key: 'slides',
  odp: 'slides',
  doc: 'document',
  docx: 'document',
  odt: 'document',
  rtf: 'document',
  txt: 'document',
  xls: 'sheet',
  xlsx: 'sheet',
  ods: 'sheet',
  csv: 'sheet',
  html: 'web',
  htm: 'web',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  avif: 'image',
};

const ICON_BY_KIND: Record<CardKind, InlineIconName> = {
  pdf: 'filePdf',
  slides: 'filePpt',
  document: 'fileDoc',
  sheet: 'fileXls',
  web: 'fileHtml',
  image: 'image',
  other: 'file',
};

export function fileCardKind(name: string): CardKind {
  return KIND_BY_EXTENSION[fileExtension(name)] ?? 'other';
}

export interface FileCardSpec {
  name: string;
  /** False when the file is not in the vault: no "Mở", the card says so. */
  found: boolean;
  onOpen: (options: { newTab: boolean }) => void;
}

/** Fills `container` with the card. */
export function renderFileCard(container: HTMLElement, spec: FileCardSpec): void {
  const kind = fileCardKind(spec.name);
  const card = document.createElement('span');
  card.className = 'file-card';
  card.dataset['kind'] = kind;
  card.dataset['found'] = String(spec.found);
  const name = document.createElement('span');
  name.className = 'file-card__name';
  name.textContent = spec.found
    ? spec.name
    : i18n.t('attachments.card.missing', { name: spec.name });
  card.append(createInlineIcon(spec.found ? ICON_BY_KIND[kind] : 'warning', 'file-card__icon'));
  card.append(name);
  if (spec.found) {
    const kindLabel = document.createElement('span');
    kindLabel.className = 'file-card__kind';
    kindLabel.textContent = i18n.t(`attachments.card.kind.${kind}`);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'file-card__open';
    // Inside the editable surface the card is reached as a selected node (Enter opens it).
    open.tabIndex = -1;
    open.textContent = i18n.t('attachments.card.open');
    open.setAttribute('aria-label', i18n.t('attachments.card.openLabel', { name: spec.name }));
    open.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      spec.onOpen({ newTab: event.ctrlKey || event.metaKey });
    });
    card.append(kindLabel, open);
  }
  container.replaceChildren(card);
}
