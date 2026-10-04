import type { Pt } from '../plot/viewport';
import { panBy, pinchViewport, wheelZoomFactor, zoomAt } from '../plot/viewport';
import type { GraphController } from '../render/controller';

export interface GestureCallbacks {
  /** Pointer hovering (mouse/pen, no buttons): update the trace. */
  hover(sx: number, sy: number): void;
  /** Pointer left the graph or a drag started: hide a hover trace. */
  leave(): void;
  /** A quick tap without movement (touch pins the trace there). */
  tap(sx: number, sy: number, pointerType: string): void;
  /** Any pointer went down on the graph. */
  down(pointerType: string): void;
}

const TAP_MOVE_PX = 6;
const TAP_MS = 300;

/** Pan with one pointer, pinch-zoom with two, wheel/trackpad zoom, double-click zoom, keys. */
export function attachGestures(
  el: HTMLElement,
  controller: GraphController,
  cb: GestureCallbacks,
): () => void {
  const pointers = new Map<number, Pt>();
  let tapStart: { x: number; y: number; time: number; id: number } | null = null;
  let moved = false;

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('button')) return;
    cb.down(e.pointerType);
    el.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      tapStart = { ...p, time: performance.now(), id: e.pointerId };
      moved = false;
    } else {
      tapStart = null;
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType !== 'touch') cb.hover(p.x, p.y);
      return;
    }
    if (tapStart && Math.hypot(p.x - tapStart.x, p.y - tapStart.y) > TAP_MOVE_PX) {
      moved = true;
      tapStart = null;
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
    const p = local(e);
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey, el.clientHeight);
    const next = zoomAt(controller.view, p.x, p.y, factor);
    if (next !== controller.view) controller.setView(next);
    cb.hover(p.x, p.y);
  };

  const onDblClick = (e: MouseEvent) => {
    const p = local(e);
    controller.animateTo(zoomAt(controller.view, p.x, p.y, 2));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== el) return;
    const step = 40;
    const v = controller.view;
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
        controller.setView(panBy(v, step, 0));
        break;
      case 'ArrowRight':
        controller.setView(panBy(v, -step, 0));
        break;
      case 'ArrowUp':
        controller.setView(panBy(v, 0, step));
        break;
      case 'ArrowDown':
        controller.setView(panBy(v, 0, -step));
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
