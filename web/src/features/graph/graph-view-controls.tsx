import { ArrowsIn, MagnifyingGlassMinus, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export interface GraphViewControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

/** Zoom and reset buttons over the canvas (the same as the `+`, `-` and `0` keys). */
export function GraphViewControls({ onZoomIn, onZoomOut, onReset }: GraphViewControlsProps) {
  const { t } = useTranslation();
  const buttons = [
    { label: t('graph.controls.zoomIn'), Icon: MagnifyingGlassPlus, run: onZoomIn },
    { label: t('graph.controls.zoomOut'), Icon: MagnifyingGlassMinus, run: onZoomOut },
    { label: t('graph.controls.reset'), Icon: ArrowsIn, run: onReset },
  ];
  return (
    <div
      className="graph-controls"
      role="group"
      aria-label={t('graph.controls.label')}
      data-graph-overlay
    >
      {buttons.map(({ label, Icon, run }) => (
        <button
          key={label}
          type="button"
          className="icon-button graph-controls__button"
          aria-label={label}
          title={label}
          onClick={run}
        >
          <Icon size={18} aria-hidden="true" focusable="false" />
        </button>
      ))}
    </div>
  );
}
