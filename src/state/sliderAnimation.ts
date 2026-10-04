import { createEffect, createRoot } from 'solid-js';
import { analysis } from './analysis';
import { doc, setSliderPlaying } from './doc';
import { setSliderValue, sliderBounds } from './rowActions';

const PERIOD_MS = 5000; // one sweep from min to max

/** One rAF loop drives every playing slider, bouncing between its bounds. */
createRoot(() => {
  const direction = new Map<string, 1 | -1>();
  // Unrounded positions: the source text is rounded/snapped, which would stall small increments.
  const position = new Map<string, number>();
  let frame = 0;
  let last = 0;

  const tick = (now: number) => {
    const dt = Math.min(100, now - last);
    last = now;
    let any = false;
    for (const row of doc.rows) {
      if (!row.slider.playing) {
        position.delete(row.id);
        continue;
      }
      const res = analysis().byId.get(row.id);
      const { min, max } = sliderBounds(row.id);
      if (!res?.slider || !(max > min)) {
        setSliderPlaying(row.id, false);
        continue;
      }
      any = true;
      let dir = direction.get(row.id) ?? 1;
      const current = position.get(row.id) ?? res.slider.value;
      let v = current + (dir * (max - min) * dt) / PERIOD_MS;
      if (v >= max) {
        v = max;
        dir = -1;
      } else if (v <= min) {
        v = min;
        dir = 1;
      }
      direction.set(row.id, dir);
      position.set(row.id, v);
      setSliderValue(row.id, v);
    }
    frame = any ? requestAnimationFrame(tick) : 0;
  };

  createEffect(() => {
    const playing = doc.rows.some((r) => r.slider.playing);
    if (playing && !frame) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  });
});
