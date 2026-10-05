import type { Pt } from '../plot/viewport';
import { panBy, pinchViewport, wheelZoomFactor, zoomAt } from '../plot/viewport';
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

/**
 * Pan with one pointer, pinch-zoom with two, wheel/trackpad zoom, double-click zoom, keys. On
 * touch, a drag from the pinned trace's dot (or a press held on a curve) scrubs along the curve
 * instead.
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
    // Finish a running zoom animation first, so the gesture starts from where it ends.
    controller.settle();
    el.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    stopHold();
    if (pointers.size === 1) {
      tapStart = { ...p, time: performance.now(), id: e.pointerId };
      moved = false;
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
            }
          }, HOLD_MS);
        }
      }
    } else {
      // A second finger: a pinch, never a scrub.
      tapStart = null;
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
        pointers.set(e.pointerId, p);
        cb.scrub?.(p.x, p.y);
        return;
      }
      cb.leave();
    }
    if (!moved && pointers.size === 1) return;
    if (pointers.size === 1) {
      controller.setView(panBy(controller.view, p.x - prev.x, p.y - prev.y));
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
    if (
      e.type === 'pointerup' &&
      tapStart &&
      tapStart.id === e.pointerId &&
      !moved &&
      performance.now() - tapStart.time < TAP_MS
    ) {
      const p = local(e);
      cb.tap(p.x, p.y, e.pointerType);
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
    controller.settle();
    const p = local(e);
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey, el.clientHeight);
    const next = zoomAt(controller.view, p.x, p.y, factor);
    if (next !== controller.view) controller.setView(next);
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
    const step = 40;
    const pan = (dx: number, dy: number) => {
      controller.settle();
      controller.setView(panBy(controller.view, dx, dy));
    };
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
