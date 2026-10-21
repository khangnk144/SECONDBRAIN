/**
 * Canvas controller: owns the 2D context, viewport, frame loop and pointer input of one graph
 * canvas. Frames are drawn only while something moves (intro, signal, live settling, drift);
 * otherwise a change (hover, selection, theme, size) requests exactly one frame.
 */
import { GraphTouchEffects, type AiTouchPlay } from './graph-ai-touch-effect';
import { GraphCamera } from './graph-camera';
import { drawGraph, type FrameInput, type LabelRect } from './graph-draw';
import { FpsMeter } from './graph-fps-meter';
import { pinnedFitLabels } from './graph-label-fit';
import { isSettling, settleNow, tickLive } from './graph-layout';
import { DRIFT_AMPLITUDE_PX } from './graph-motion';
import { browserFrameScheduler, GraphMotionClock, type FrameScheduler } from './graph-motion-clock';
import type { GraphPalette } from './graph-palette';
import { GraphPointerInput, type PointerInputHost } from './graph-pointer-input';
import type { GraphScene } from './graph-scene';
import * as vp from './graph-viewport';

/** Extra reach (CSS px) around a dot that still counts as a hit. */
const HIT_SLACK_PX = 4;

export interface GraphViewOptions {
  /** `local`: the static mini graph of a note (hover only, no motion, no pan or zoom). */
  mode: 'full' | 'local';
  palette: GraphPalette;
  reducedMotion: boolean;
  scheduler?: FrameScheduler;
  onNodeClick?: (id: string) => void;
  onBackgroundClick?: () => void;
  onNodeOpen?: (id: string) => void;
  onHoverChange?: (id: string | null) => void;
  /** Set only for `?debug=fps`: keeps the loop running and reports fps once per second. */
  onFps?: (fps: number) => void;
}

export class GraphView implements PointerInputHost {
  scene: GraphScene | null = null;
  private readonly camera = new GraphCamera();
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly scheduler: FrameScheduler;
  private readonly clock = new GraphMotionClock();
  /** Pointer and wheel handlers for the canvas element. */
  readonly input: GraphPointerInput;
  private readonly fps: FpsMeter | null;
  private frame: FrameInput | null = null;
  private palette: GraphPalette;
  private reducedMotion: boolean;
  private handle = 0;
  private hidden = false;
  private labelExclusions: readonly LabelRect[] = [];
  /** "AI vừa chạm" playbacks (full map only). */
  private readonly touches = new GraphTouchEffects();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly options: GraphViewOptions,
  ) {
    this.ctx = canvas.getContext('2d');
    this.scheduler = options.scheduler ?? browserFrameScheduler;
    this.palette = options.palette;
    this.reducedMotion = options.reducedMotion;
    this.fps = options.onFps ? new FpsMeter(options.onFps) : null;
    this.input = new GraphPointerInput(this);
  }

  get viewport(): vp.Viewport {
    return this.camera.viewport;
  }

  /** Intro, signal, live settling and drift run only on the full map without reduced motion. */
  get animated(): boolean {
    return this.options.mode === 'full' && !this.reducedMotion;
  }

  setScene(scene: GraphScene, options: { intro: boolean; fit: boolean }): void {
    this.scene = scene;
    this.input.reset();
    if (!this.animated && isSettling(scene.simulation)) settleNow(scene.simulation);
    this.clock.stopSignal();
    if (options.intro && this.animated) this.clock.startIntro();
    else this.clock.stopIntro();
    if (options.fit) this.camera.requestFit();
    scene.markMoved();
    this.frame = scene.frameInput(this.palette, this.viewport, this.camera.size);
    this.applyCamera();
    this.requestFrame();
  }

  /** New colors or font: names are measured again (a local graph refits to its note's name). */
  setPalette(palette: GraphPalette): void {
    this.palette = palette;
    if (this.scene) this.frame = this.scene.frameInput(palette, this.viewport, this.camera.size);
    if (this.options.mode === 'local') {
      this.camera.requestFit();
      this.applyCamera();
    }
    this.requestFrame();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    const scene = this.scene;
    if (this.animated || !scene) return;
    this.clock.stopIntro();
    if (this.clock.signalRunning) scene.finishSignal();
    this.clock.stopSignal();
    if (isSettling(scene.simulation)) settleNow(scene.simulation);
    scene.markMoved();
    this.requestFrame();
  }

  setSize(width: number, height: number, dpr: number): void {
    if (!this.camera.resize(width, height, dpr)) return;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    if (this.frame) Object.assign(this.frame, { width, height, dpr });
    this.applyCamera();
    this.requestFrame();
  }

  /** Mirrors the screen's selection (`null` clears); a new ring lights up via the signal. */
  setSelection(id: string | null, depth: 1 | 2): void {
    const scene = this.scene;
    if (!scene) return;
    const index = id === null ? -1 : (scene.model.indexById.get(id) ?? -1);
    const current = scene.selection;
    if (index < 0 && !current) return;
    if (current && current.index === index && current.depth === depth) return;
    const animate = this.animated && index >= 0;
    scene.select(index, depth, animate);
    if (animate) this.clock.startSignal();
    else this.clock.stopSignal();
    this.requestFrame();
  }

  centerOnNode(id: string): void {
    this.camera.requestCenter(id);
    this.applyCamera();
    this.requestFrame();
  }

  resetView(): void {
    this.camera.requestFit();
    this.applyCamera();
    this.requestFrame();
  }

  zoomBy(factor: number): void {
    this.camera.zoomCenter(factor);
    this.requestFrame();
  }

  /** "AI vừa chạm": the playbacks to show; `wallNow` is `Date.now()` now (their plans' clock). */
  setAiTouches(plays: readonly AiTouchPlay[], wallNow: number): void {
    if (this.options.mode !== 'full') return;
    this.touches.restore(this.scene);
    this.touches.set(plays, wallNow);
    this.requestFrame();
  }

  /** Canvas areas covered by overlays (title, controls, legend), which names keep off. */
  setLabelExclusions(rects: readonly LabelRect[]): void {
    this.labelExclusions = rects;
    this.requestFrame();
  }

  /** Stops the loop while the tab is hidden; resumes without a jump. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.cancelFrame();
    else {
      this.clock.resetFrameTime();
      this.fps?.reset();
      this.requestFrame();
    }
  }

  destroy(): void {
    this.cancelFrame();
    this.hidden = true;
  }

  /** Pending fit and center; a local graph's fit keeps its own note's name inside. */
  private applyCamera(): void {
    const { scene, ctx, frame } = this;
    this.camera.apply(scene?.model ?? null, () => pinnedFitLabels(ctx, frame, scene));
  }

  /** Node under the canvas point (CSS px), or -1. */
  hitAt(x: number, y: number): number {
    const scene = this.scene;
    if (!scene) return -1;
    const s = this.viewport.scale;
    const margin = this.animated ? (DRIFT_AMPLITUDE_PX * 1.5) / s : 0;
    const wx = vp.toWorldX(this.viewport, x);
    const wy = vp.toWorldY(this.viewport, y);
    return scene.hitTest(wx, wy, HIT_SLACK_PX / s, margin, this.clock.introRunning);
  }

  hoveredId(): string | null {
    const scene = this.scene;
    return scene && scene.hover >= 0 ? (scene.model.nodes[scene.hover]?.id ?? null) : null;
  }

  setHover(index: number): void {
    if (!this.scene?.setHover(index)) return;
    this.options.onHoverChange?.(this.hoveredId());
    this.requestFrame();
  }

  requestFrame(): void {
    if (this.handle !== 0 || this.hidden || !this.ctx || !this.scene) return;
    this.handle = this.scheduler.request(this.onFrame);
  }

  private cancelFrame(): void {
    if (this.handle !== 0) this.scheduler.cancel(this.handle);
    this.handle = 0;
  }

  private readonly onFrame = (now: number): void => {
    this.handle = 0;
    if (this.renderFrame(now)) this.requestFrame();
  };

  /** Draws the frame at `now` (ms); returns whether another frame is needed. */
  renderFrame(now: number): boolean {
    const { scene, ctx, frame, clock } = this;
    if (!scene || !ctx || !frame || !this.camera.hasSize) return false;
    clock.advance(now, this.animated);
    if (clock.signalArrived) scene.finishSignal();
    const settling = this.animated && isSettling(scene.simulation);
    if (settling) {
      tickLive(scene.simulation);
      scene.markMoved();
    }
    const drift = this.animated ? clock.driftClock : null;
    scene.computePositions(clock.intro, drift, this.viewport.scale);
    // Under reduced motion a playback is a still picture: the screen redraws it when it ends.
    if (!this.touches.empty) {
      this.touches.update(
        scene,
        now,
        this.viewport,
        this.camera.size,
        this.animated,
        this.labelExclusions,
      );
    }
    frame.touch = this.touches.empty ? null : this.touches.frame;
    frame.ring = scene.selection?.index ?? -1;
    frame.hover = scene.hover;
    frame.levels = scene.levels;
    frame.signalProgress = clock.signal;
    frame.signalFromLevel = scene.signalFrom;
    // Quiet hub names on the full map, once the dots have opened out from the center.
    frame.ambientLabels = this.options.mode === 'full' && !clock.introRunning;
    frame.labelExclusions = this.labelExclusions;
    drawGraph(ctx, frame);
    this.fps?.frame(now);
    return clock.running || settling || this.animated || this.fps !== null;
  }
}
