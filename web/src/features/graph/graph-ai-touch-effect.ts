/**
 * The canvas side of "AI vừa chạm": per frame, where the source is drawn (it grows in at the
 * canvas edge nearest its place and glides there; a source that is not on the map, or not on
 * screen, stays as a hollow dot at that edge), where each signal is on its way to an output, and
 * which outputs are lit. Times come from the store's plan (wall-clock ms); frame timestamps are
 * mapped onto that clock once per hand-over, so tests drive it with plain numbers.
 */
import type { VaultPath } from '../../lib/api/vault-types';
import { AI_TOUCH_ENTRY_MS, type AiTouchPlayback } from './graph-ai-touch';
import type { LabelRect } from './graph-draw';
import { outputStateAt, sourceEntry } from './graph-ai-touch-geometry';
import { indexOfPath } from './graph-model';
import { easeOutCubic } from './graph-motion';
import type { CanvasSize, GraphScene } from './graph-scene';
import type { Viewport } from './graph-viewport';

/** What the canvas needs of one event to play it. */
export interface AiTouchPlay {
  id: number;
  source: VaultPath;
  /** Name shown next to a source that is not on the map. */
  sourceTitle: string;
  playback: AiTouchPlayback;
}

/** One event as drawn in the current frame (world units). */
export interface TouchFramePlay {
  /** The source is not drawn as a map node here: a hollow dot of its own at the canvas edge. */
  ghost: boolean;
  sourceIndex: number;
  sourceX: number;
  sourceY: number;
  /** 0 → 1 while the source grows in. */
  sourceScale: number;
  sourceTitle: string;
  outputs: Int32Array;
  /** Halo opacity per output (0 = not lit). */
  litAlpha: Float32Array;
  /** Signal position per output (0 → 1 while on its way, -1 otherwise). */
  signal: Float32Array;
}

export interface TouchFrame {
  plays: TouchFramePlay[];
}

interface Resolved {
  play: AiTouchPlay;
  frame: TouchFramePlay;
  at: Float64Array;
  anchored: boolean;
  entryX: number;
  entryY: number;
}

export class GraphTouchEffects {
  readonly frame: TouchFrame = { plays: [] };
  private plays: readonly AiTouchPlay[] = [];
  private resolved: Resolved[] = [];
  private resolvedFor: GraphScene | null = null;
  private wallAnchor = 0;
  private frameAnchor: number | null = null;
  private mask = new Uint8Array(0);
  private shownMask = new Uint8Array(0);

  get empty(): boolean {
    return this.plays.length === 0;
  }

  /** New set of playbacks; `wallNow` is `Date.now()` at the hand-over. */
  set(plays: readonly AiTouchPlay[], wallNow: number): void {
    this.plays = plays;
    this.resolvedFor = null;
    this.wallAnchor = wallNow;
    this.frameAnchor = null;
  }

  private resolve(scene: GraphScene): void {
    const model = scene.model;
    const kept = new Map(this.resolved.map((r) => [r.play.id, r]));
    this.resolved = this.plays.map((play) => {
      const steps = play.playback.sequence;
      const outputs = Int32Array.from(steps, (step) => indexOfPath(model, step.path));
      const previous = kept.get(play.id);
      const frame: TouchFramePlay = {
        ghost: false,
        sourceIndex: indexOfPath(model, play.source),
        sourceX: 0,
        sourceY: 0,
        sourceScale: 1,
        sourceTitle: play.sourceTitle,
        outputs,
        litAlpha: new Float32Array(outputs.length),
        signal: new Float32Array(outputs.length).fill(-1),
      };
      // A refreshed map keeps positions, so the entry point chosen before stays valid.
      const wasOnMap = previous !== undefined && previous.frame.sourceIndex >= 0;
      const anchored =
        previous !== undefined && previous.anchored && wasOnMap === frame.sourceIndex >= 0;
      if (anchored) frame.ghost = previous.frame.ghost;
      return {
        play,
        frame,
        at: Float64Array.from(steps, (step) => step.at),
        anchored,
        entryX: previous?.entryX ?? 0,
        entryY: previous?.entryY ?? 0,
      };
    });
    this.resolvedFor = scene;
    if (this.mask.length !== model.nodes.length) {
      this.mask = new Uint8Array(model.nodes.length);
      this.shownMask = new Uint8Array(model.nodes.length);
    }
  }

  /** Picks where the source enters, from the view at the first frame of its playback. */
  private anchor(
    r: Resolved,
    scene: GraphScene,
    view: Viewport,
    size: CanvasSize,
    overlays: readonly LabelRect[],
  ): void {
    const entry = sourceEntry(scene, view, size, r.frame.sourceIndex, r.frame.outputs, overlays);
    r.frame.ghost = entry.ghost;
    r.entryX = entry.x;
    r.entryY = entry.y;
    r.anchored = true;
  }

  /**
   * Advances to the frame at `frameNow`: positions the sources (moving a map node during its
   * entry), the signals and the halos, and marks lit nodes on the scene (emphasis and names).
   * Returns whether any playback is still running or waiting for its turn. `overlays` are the
   * canvas areas under the legend and controls (screen px), which an entering source avoids.
   */
  update(
    scene: GraphScene,
    frameNow: number,
    view: Viewport,
    size: CanvasSize,
    animated: boolean,
    overlays: readonly LabelRect[] = [],
  ): boolean {
    if (this.resolvedFor !== scene) this.resolve(scene);
    if (this.frameAnchor === null) this.frameAnchor = frameNow;
    const wall = this.wallAnchor + (frameNow - this.frameAnchor);
    this.mask.fill(0);
    this.frame.plays.length = 0;
    let running = false;
    for (const r of this.resolved) {
      const { playback } = r.play;
      if (wall >= playback.endsAt) continue;
      running = true;
      if (wall < playback.startedAt) continue;
      if (!r.anchored) this.anchor(r, scene, view, size, overlays);
      this.place(r, scene, wall, animated && !playback.reducedMotion);
      this.frame.plays.push(r.frame);
    }
    this.publishMask(scene);
    return running;
  }

  private place(r: Resolved, scene: GraphScene, wall: number, motion: boolean): void {
    const f = r.frame;
    const s = f.sourceIndex;
    const entry = motion ? easeOutCubic((wall - r.play.playback.startedAt) / AI_TOUCH_ENTRY_MS) : 1;
    f.sourceScale = entry;
    if (f.ghost) {
      f.sourceX = r.entryX;
      f.sourceY = r.entryY;
    } else {
      // The map node itself glides in from the edge (layout positions are rewritten each frame).
      const x = r.entryX + ((scene.px[s] ?? 0) - r.entryX) * entry;
      const y = r.entryY + ((scene.py[s] ?? 0) - r.entryY) * entry;
      scene.px[s] = x;
      scene.py[s] = y;
      scene.radius[s] = (scene.model.nodes[s]?.radius ?? 0) * Math.max(entry, 0.01);
      f.sourceX = x;
      f.sourceY = y;
    }
    if (s >= 0) this.mask[s] = 1;
    for (let k = 0; k < f.outputs.length; k++) {
      const o = f.outputs[k] ?? -1;
      const state = outputStateAt(r.at[k] ?? 0, wall, motion);
      f.signal[k] = o >= 0 ? state.signal : -1;
      f.litAlpha[k] = o >= 0 ? state.halo : 0;
      if (o >= 0 && state.lit) this.mask[o] = 1;
    }
  }

  /** Hands the lit set to the scene only when it changed (a highlight pass sorts names). */
  private publishMask(scene: GraphScene): void {
    let changed = false;
    let any = false;
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i] !== this.shownMask[i]) changed = true;
      if (this.mask[i] === 1) any = true;
    }
    if (!changed && scene.touched === (any ? this.shownMask : null)) return;
    this.shownMask.set(this.mask);
    scene.setTouched(any ? this.shownMask : null);
  }

  /**
   * Before new playbacks: puts back the radius of a source that was growing in and clears the
   * lit nodes (the next frame lights what is still running).
   */
  restore(scene: GraphScene | null): void {
    if (!scene) return;
    if (this.resolvedFor === scene) {
      for (const r of this.resolved) {
        const s = r.frame.sourceIndex;
        if (s >= 0) scene.radius[s] = scene.model.nodes[s]?.radius ?? scene.radius[s] ?? 0;
      }
    }
    if (scene.touched) scene.setTouched(null);
  }
}
