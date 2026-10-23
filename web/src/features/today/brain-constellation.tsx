import { useMemo } from 'react';
import type { TodayBrain } from '../../lib/api/deadlines-types';
import { layoutBrain, type BrainLayoutBox } from './brain-layout';
import './brain-map.css';

export interface BrainConstellationProps {
  brain: Pick<TodayBrain, 'nodes' | 'edges'>;
  /** Keep it a module constant (the layout is memoized on it). */
  box: BrainLayoutBox;
  className?: string;
  /** Accessible name (`role="img"`); without it the picture is hidden from assistive technology. */
  label?: string;
}

/**
 * The mini map of today's notes: thin links and dots coloured like the brain map's groups
 * (`--graph-*` tokens through `.brain-map__node--<group>`). Static: no physics, no motion.
 */
export function BrainConstellation({ brain, box, className, label }: BrainConstellationProps) {
  const layout = useMemo(() => layoutBrain(brain, box), [brain, box]);
  const classes = className ? `brain-map ${className}` : 'brain-map';
  return (
    <svg
      className={classes}
      viewBox={`0 0 ${box.width} ${box.height}`}
      preserveAspectRatio="xMidYMid meet"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g className="brain-map__edges">
        {layout.edges.map((edge) => (
          <line key={edge.key} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
        ))}
      </g>
      {layout.nodes.map((node) => (
        <circle
          key={node.path}
          className={`brain-map__node brain-map__node--${node.group}`}
          cx={node.x}
          cy={node.y}
          r={node.r}
        />
      ))}
    </svg>
  );
}
