import { flingVelocity, inputTime, recordSample, type Sample } from '../plot/inertia';
import type { Pt } from '../plot/viewport';
import { isWheelNotch, panBy, pinchViewport, wheelZoomFactor, zoomAt } from '../plot/viewport';
import type { GraphController } from '../render/controller';

export interface GestureCallbacks {
  /** Pointer hovering (mouse/pen, no buttons): update the trace. */
  hover(sx: number, sy: number): void;
  /** Pointer left the graph or a drag started: hide a hover trace. */
  leave(): void;
  /** A quick tap without movement (touch pins the trace there, and dismisses the keypad). */
  tap(sx: number, sy: number, pointerType: string): void;
  /**
   * A touch or pen press: whether a drag from it scrubs along a curve instead of panning (it is
   * on the pinned trace's dot). Released without moving, it is still a tap.
   */
  scrubStart?(sx: number, sy: number): boolean;
  /**
   * A touch or pen press held still for HOLD_MS: whether it starts a scrub (it is on a curve).
   * The press is no tap after that, so this does what a tap would have.
   */
  hold?(sx: number, sy: number): boolean;
  /** The scrubbing finger moved. */
  scrub?(sx: number, sy: number): void;
  /** The scrubbing finger lifted (or a second one came down). */
  scrubEnd?(): void;
}

const TAP_MOVE_PX = 6;
const TAP_MS = 300;
/**
 * A press held this long without moving picks up the curve under it to scrub along. Longer
 * than a tap, so a slow tap is never taken for a hold.
 */
const HOLD_MS = 350;

/** An arrow key pans the graph this far (CSS px). */
const KEY_STEP_PX = 40;

/** When an input happened (see inertia.ts inputTime). */
const timeOf = (e: Event) => inputTime(e.timeStamp, performance.now());

/** Every position a move reports, the ones the browser merged into it first (each stamped). */
function movesOf(e: PointerEvent): readonly PointerEvent[] {
  const merged = e.getCoalescedEvents?.() ?? [];
  return merged.length > 0 ? merged : [e];
}

/**
 * Pan with one pointer, pinch-zoom with two, wheel/trackpad zoom, double-click zoom, keys. On
 * touch, a drag from the pinned trace's dot (or a press held on a curve) scrubs along the curve
 * instead. A finger or pen that lets go of a pan while moving flings the view, which glides on
 * until a new press, wheel or key catches it; a mouse wheel's notches and the arrow keys move
 * in short animated steps that compose, while a trackpad's stream of small deltas is followed
 * as it comes.
 */
export function attachGestures(
  el: HTMLElement,
  controller: GraphController,
  cb: GestureCallbacks,
): () => void {
  const pointers = new Map<number, Pt>();
  let tapStart: { x: number; y: number; time: number; id: number } | null = null;
  let moved = false;
  /** The pointer scrubbing along a curve, if one is. */
  let scrubbing: number | null = null;
  /** The pointer pressed on the pinned trace's dot: it scrubs once it moves. */
  let grab: number | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  /** Where a finger or pen panning has lately been, for the velocity it lets go with. */
  let samples: Sample[] = [];
  /**
   * The gesture may end in a fling: a finger or pen panning on its own. Not a mouse, and never
   * once it pinched or scrubbed along a curve.
   */
  let flingable = false;
  /** The press caught a gliding view: it stops it, and is no tap. */
  let caught = false;

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /**
   * Events on the overlaid controls (zoom, home, show list) belong to them, including the gaps
   * and rim of their pill, which reads as chrome rather than graph. Points of interest are part
   * of the graph: hovering one traces it, and a drag from one pans.
   */
  const onControl = (e: Event) =>
    (e.target as HTMLElement).closest('button:not(.poi), .graph-controls') !== null;

  const stopHold = () => {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  };

  const stopScrub = () => {
    grab = null;
    if (scrubbing === null) return;
    scrubbing = null;
    cb.scrubEnd?.();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (onControl(e)) return;
    // Catch a gliding view where it is; finish a running zoom animation, so the gesture starts
    // from where it ends.
    const stopped = controller.stop();
    controller.settle();
    el.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    stopHold();
    if (pointers.size === 1) {
      const now = performance.now();
      tapStart = { ...p, time: now, id: e.pointerId };
      moved = false;
      caught = stopped;
      flingable = e.pointerType !== 'mouse';
      samples = [];
      if (flingable) recordSample(samples, { ...p, t: timeOf(e) });
      if (e.pointerType !== 'mouse') {
        if (cb.scrubStart?.(p.x, p.y)) {
          grab = e.pointerId;
        } else if (cb.hold) {
          const hold = cb.hold;
          holdTimer = setTimeout(() => {
            holdTimer = undefined;
            const at = pointers.get(e.pointerId);
            if (pointers.size === 1 && at && !moved && hold(at.x, at.y)) {
              scrubbing = e.pointerId;
              tapStart = null;
              flingable = false;
            }
          }, HOLD_MS);
        }
      }
    } else {
      // A second finger: a pinch, never a scrub, nor a fling once it lets go.
      tapStart = null;
      flingable = false;
      stopScrub();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'touch') return;
      // Over the controls, nothing underneath is traced.
      if (onControl(e)) cb.leave();
      else cb.hover(p.x, p.y);
      return;
    }
    if (scrubbing === e.pointerId) {
      pointers.set(e.pointerId, p);
      cb.scrub?.(p.x, p.y);
      return;
    }
    if (tapStart && Math.hypot(p.x - tapStart.x, p.y - tapStart.y) > TAP_MOVE_PX) {
      moved = true;
      tapStart = null;
      stopHold();
      if (grab === e.pointerId) {
        grab = null;
        scrubbing = e.pointerId;
        flingable = false;
        pointers.set(e.pointerId, p);
        cb.scrub?.(p.x, p.y);
        return;
      }
      cb.leave();
    }
    if (!moved && pointers.size === 1) return;
    // A wheel notch or arrow step still on its way ends first, so the drag goes on from there
    // rather than cutting it short.
    controller.settle();
    if (pointers.size === 1) {
      controller.setView(panBy(controller.view, p.x - prev.x, p.y - prev.y));
      if (flingable) {
        for (const m of movesOf(e)) recordSample(samples, { ...local(m), t: timeOf(m) });
      }
    } else if (pointers.size === 2) {
      const [idA, idB] = [...pointers.keys()];
      const prevA = pointers.get(idA) as Pt;
      const prevB = pointers.get(idB) as Pt;
      const nextA = idA === e.pointerId ? p : prevA;
      const nextB = idB === e.pointerId ? p : prevB;
      controller.setView(pinchViewport(controller.view, prevA, prevB, nextA, nextB));
    }
    pointers.set(e.pointerId, p);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    stopHold();
    if (scrubbing === e.pointerId || grab === e.pointerId) stopScrub();
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const now = performance.now();
    if (
      e.type === 'pointerup' &&
      tapStart &&
      tapStart.id === e.pointerId &&
      !moved &&
      !caught &&
      now - tapStart.time < TAP_MS
    ) {
      const p = local(e);
      cb.tap(p.x, p.y, e.pointerType);
    }
    // Let go of a pan while moving: the view glides on, from when the finger lifted.
    if (e.type === 'pointerup' && pointers.size === 0 && flingable && moved) {
      const at = timeOf(e);
      const v = flingVelocity(samples, at);
      if (v) controller.fling(v, at);
    }
    if (pointers.size === 0) {
      flingable = false;
      samples = [];
    }
    tapStart = null;
    // After a pinch, the remaining finger continues as a pan without a jump.
    moved = pointers.size > 0;
  };

  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' && !pointers.has(e.pointerId)) cb.leave();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey, el.clientHeight);
    if (isWheelNotch(e.deltaY, e.deltaMode)) {
      // A mouse wheel's notch: a short animated step, going on from where the last one ends.
      if (factor !== 1) controller.wheelStep(factor, p.x, p.y);
    } else {
      // A trackpad: followed as it comes, from where a running animation ends.
      controller.settle();
      const next = zoomAt(controller.view, p.x, p.y, factor);
      if (next !== controller.view) controller.setView(next);
      else controller.stop();
    }
    if (!onControl(e)) cb.hover(p.x, p.y);
  };

  const onDblClick = (e: MouseEvent) => {
    if (onControl(e)) return;
    controller.settle();
    const p = local(e);
    controller.animateTo(zoomAt(controller.view, p.x, p.y, 2));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== el) return;
    const step = KEY_STEP_PX;
    // An animated step, going on from where a running one ends (a held key glides along).
    const pan = (dx: number, dy: number) => controller.pan(dx, dy);
    switch (e.key) {
      case '+':
      case '=':
        controller.zoomCenter(2);
        break;
      case '-':
      case '_':
        controller.zoomCenter(0.5);
        break;
      case '0':
        controller.home();
        break;
      case 'ArrowLeft':
        pan(step, 0);
        break;
      case 'ArrowRight':
        pan(-step, 0);
        break;
      case 'ArrowUp':
        pan(0, step);
        break;
      case 'ArrowDown':
        pan(0, -step);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('pointerleave', onPointerLeave);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', onDblClick);
  el.addEventListener('keydown', onKeyDown);
  return () => {
    stopHold();
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.removeEventListener('pointerleave', onPointerLeave);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('dblclick', onDblClick);
    el.removeEventListener('keydown', onKeyDown);
  };
}
