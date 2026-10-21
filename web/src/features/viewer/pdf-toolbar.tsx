import {
  ArrowSquareOut,
  ArrowsHorizontal,
  CaretDown,
  CaretUp,
  DownloadSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ZOOM, MIN_ZOOM, zoomPercent } from './pdf-zoom';

export interface PdfToolbarProps {
  page: number;
  pageCount: number;
  zoom: number;
  fitWidth: boolean;
  onPage: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onDownload: () => void;
  onOpenExternal: () => void;
}

function ToolButton(props: {
  label: string;
  hint?: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      className={props.wide ? 'pdf-toolbar__button pdf-toolbar__button--wide' : 'icon-button'}
      aria-label={props.wide ? undefined : props.label}
      aria-pressed={props.pressed}
      title={props.hint ?? props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** Page field: shows the current page, takes a typed number on Enter or when leaving it. */
function PageField({
  page,
  pageCount,
  onPage,
}: Pick<PdfToolbarProps, 'page' | 'pageCount' | 'onPage'>) {
  const { t } = useTranslation();
  const [text, setText] = useState(String(page));
  useEffect(() => setText(String(page)), [page]);
  const commit = () => {
    const wanted = Number.parseInt(text, 10);
    if (Number.isFinite(wanted) && wanted >= 1 && wanted <= pageCount) onPage(wanted);
    else setText(String(page));
  };
  return (
    <label className="pdf-toolbar__page">
      <span>{t('viewer.pdf.pageWord')}</span>
      <input
        className="text-input pdf-toolbar__page-input"
        inputMode="numeric"
        aria-label={t('viewer.pdf.pageInput', { count: pageCount })}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape' && text !== String(page)) {
            event.preventDefault();
            setText(String(page));
          }
        }}
      />
      <span aria-hidden="true">{t('viewer.pdf.pageOf', { total: pageCount })}</span>
    </label>
  );
}

/** "Trang 3 / 12", previous/next, zoom out/in with the percentage, fit width, download, open. */
export function PdfToolbar(props: PdfToolbarProps) {
  const { t } = useTranslation();
  const { page, pageCount, zoom } = props;
  return (
    <div className="pdf-toolbar" role="toolbar" aria-label={t('viewer.pdf.toolbar')}>
      <div className="pdf-toolbar__group">
        <ToolButton
          label={t('viewer.pdf.previous')}
          hint={t('viewer.pdf.withKey', { label: t('viewer.pdf.previous'), keys: 'PageUp' })}
          disabled={page <= 1}
          onClick={() => props.onPage(page - 1)}
        >
          <CaretUp size={18} aria-hidden="true" focusable="false" />
        </ToolButton>
        <ToolButton
          label={t('viewer.pdf.next')}
          hint={t('viewer.pdf.withKey', { label: t('viewer.pdf.next'), keys: 'PageDown' })}
          disabled={page >= pageCount}
          onClick={() => props.onPage(page + 1)}
        >
          <CaretDown size={18} aria-hidden="true" focusable="false" />
        </ToolButton>
        <PageField page={page} pageCount={pageCount} onPage={props.onPage} />
      </div>
      <div className="pdf-toolbar__group">
        <ToolButton
          label={t('viewer.pdf.zoomOut')}
          hint={t('viewer.pdf.withKey', { label: t('viewer.pdf.zoomOut'), keys: 'Ctrl+-' })}
          disabled={zoom <= MIN_ZOOM + 0.001}
          onClick={props.onZoomOut}
        >
          <MagnifyingGlassMinus size={18} aria-hidden="true" focusable="false" />
        </ToolButton>
        <span className="pdf-toolbar__zoom" role="status">
          {t('viewer.pdf.zoomValue', { percent: zoomPercent(zoom) })}
        </span>
        <ToolButton
          label={t('viewer.pdf.zoomIn')}
          hint={t('viewer.pdf.withKey', { label: t('viewer.pdf.zoomIn'), keys: 'Ctrl+=' })}
          disabled={zoom >= MAX_ZOOM - 0.001}
          onClick={props.onZoomIn}
        >
          <MagnifyingGlassPlus size={18} aria-hidden="true" focusable="false" />
        </ToolButton>
        <ToolButton
          wide
          label={t('viewer.pdf.fitWidth')}
          pressed={props.fitWidth}
          onClick={props.onFitWidth}
        >
          <ArrowsHorizontal size={18} aria-hidden="true" focusable="false" />
          <span>{t('viewer.pdf.fitWidth')}</span>
        </ToolButton>
      </div>
      <div className="pdf-toolbar__group pdf-toolbar__group--end">
        <ToolButton wide label={t('viewer.files.download')} onClick={props.onDownload}>
          <DownloadSimple size={18} aria-hidden="true" focusable="false" />
          <span>{t('viewer.files.download')}</span>
        </ToolButton>
        <ToolButton wide label={t('viewer.files.openExternal')} onClick={props.onOpenExternal}>
          <ArrowSquareOut size={18} aria-hidden="true" focusable="false" />
          <span>{t('viewer.files.openExternal')}</span>
        </ToolButton>
      </div>
    </div>
  );
}
