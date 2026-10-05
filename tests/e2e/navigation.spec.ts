import type { Locator, Page } from '@playwright/test';
import { expect, exprInput, openApp, test } from './helpers';

/** The graph's view as [xmin, xmax, ymin, ymax]. */
async function view(page: Page) {
  return ((await page.getByTestId('graph').getAttribute('data-view')) ?? '').split(',').map(Number);
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box');
  return b;
}

/**
 * Wheel events at (sx, sy) on the graph, `gap` frames apart, then the view's widths frame by
 * frame until it rests (the run of values it drew, repeats collapsed).
 */
async function wheelWidths(
  page: Page,
  sx: number,
  sy: number,
  deltas: readonly number[],
  gap = 2,
): Promise<number[]> {
  return page.getByTestId('graph').evaluate(
    async (el, [x, y, ds, frames]) => {
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      const width = () => {
        const [a, b] = (el.getAttribute('data-view') ?? '').split(',').map(Number);
        return b - a;
      };
      const r = el.getBoundingClientRect();
      const seen = [width()];
      const note = () => {
        if (seen[seen.length - 1] !== width()) seen.push(width());
      };
      for (const deltaY of ds) {
        el.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY,
            deltaMode: 0,
            clientX: r.left + x,
            clientY: r.top + y,
            bubbles: true,
            cancelable: true,
          }),
        );
        for (let i = 0; i < frames; i++) {
          await frame();
          note();
        }
      }
      for (let i = 0; i < 30; i++) {
        await frame();
        note();
      }
      return seen;
    },
    [sx, sy, deltas, gap] as const,
  );
}

test.describe('the wheel', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse wheel and trackpad');

  test('a notch zooms in a short animated step about the cursor, and notches compose', async ({
    page,
  }) => {
    await openApp(page);
    const graph = page.getByTestId('graph');
    const { width, height } = await box(graph);
    const [x0, x1] = await view(page);
    const [sx, sy] = [width * 0.75, height * 0.3];
    const wx = x0 + (sx / width) * (x1 - x0);
    // The second notch comes while the first one's step is still on its way.
    const widths = await wheelWidths(page, sx, sy, [-100, -100]);
    expect(widths.length).toBeGreaterThan(3);
    const f = Math.exp(0.15);
    const end = await view(page);
    expect(end[1] - end[0]).toBeCloseTo((x1 - x0) / f / f, 4);
    // The point under the cursor stayed under it.
    expect(end[0] + (sx / width) * (end[1] - end[0])).toBeCloseTo(wx, 4);
  });

  test('a trackpad is followed as it comes, without animating', async ({ page }) => {
    await openApp(page);
    const { width, height } = await box(page.getByTestId('graph'));
    const [x0, x1] = await view(page);
    const widths = await wheelWidths(page, width / 2, height / 2, [-10]);
    expect(widths).toHaveLength(2);
    expect(widths[1]).toBeCloseTo((x1 - x0) / Math.exp(0.015), 3);
  });

  test('with reduced motion a notch jumps straight to its end', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    const { width, height } = await box(page.getByTestId('graph'));
    const [x0, x1] = await view(page);
    const widths = await wheelWidths(page, width / 2, height / 2, [-100]);
    expect(widths).toHaveLength(2);
    expect(widths[1]).toBeCloseTo((x1 - x0) / Math.exp(0.15), 3);
  });

  test('held arrow keys glide in steps that end exactly where they add up to', async ({ page }) => {
    await openApp(page);
    const graph = page.getByTestId('graph');
    const { width } = await box(graph);
    const [x0, x1] = await view(page);
    await graph.focus();
    // One step moves through frames in between, not at once.
    const centers = await graph.evaluate(async (el) => {
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      const center = () => {
        const [a, b] = (el.getAttribute('data-view') ?? '').split(',').map(Number);
        return (a + b) / 2;
      };
      const seen = [center()];
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      );
      for (let i = 0; i < 30; i++) {
        await frame();
        if (seen[seen.length - 1] !== center()) seen.push(center());
      }
      return seen;
    });
    expect(centers.length).toBeGreaterThan(3);
    expect(centers[centers.length - 1]).toBeCloseTo((-40 * (x1 - x0)) / width, 4);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    const end = await view(page);
    expect((end[0] + end[1]) / 2).toBeCloseTo((-5 * 40 * (x1 - x0)) / width, 4);
  });
});

type Pt = { x: number; y: number };

/**
 * Fingers on the touch screen (CDP takes touch points one at a time too), whose events carry
 * their own time stamps on a clock that `wait` moves on: the page reads a finger's speed from
 * those, so a busy test machine sending them late still makes the gesture it means.
 */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  let clock = Date.now() / 1000;
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', id: number, at: Pt) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [{ ...at, id }],
      timestamp: clock,
    });
  return {
    down: (id: number, at: Pt) => {
      // A new press is now (the clock never runs ahead of the real one).
      clock = Math.max(clock, Date.now() / 1000);
      return send('touchStart', id, at);
    },
    move: (id: number, at: Pt) => send('touchMove', id, at),
    up: (id: number, at: Pt) => send('touchEnd', id, at),
    /** Let `ms` go by, on the clock and (at least) in fact. */
    wait: async (ms: number) => {
      clock += ms / 1000;
      await page.waitForTimeout(ms);
    },
  };
}

/**
 * A quick flick across the graph's middle, `dx` px every frame, still moving as it lets go: it
 * lifts right after its last move.
 */
async function flick(page: Page, dx: number) {
  const g = await box(page.getByTestId('graph'));
  const start = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  const finger = await fingers(page);
  await finger.down(0, start);
  for (let i = 1; i <= 6; i++) {
    await finger.wait(16);
    await finger.move(0, { x: start.x + i * dx, y: start.y });
  }
  await finger.up(0, { x: start.x + 6 * dx, y: start.y });
  return { finger, start };
}

interface Glide {
  /** The view's xmin as the finger lifted. */
  released: number;
  /** Its xmin and ymin frame by frame from then on (until it rests, or a new press). */
  frames: Array<[number, number]>;
  resting: boolean;
}

/**
 * From here on, what the graph draws after a finger lifts, noted by the page itself as it
 * happens: the test's own round trips can come late (busy test machines), the glide doesn't wait.
 */
async function watchGlide(page: Page) {
  await page.getByTestId('graph').evaluate((el) => {
    const at = (): [number, number] => {
      const [xmin, , ymin] = (el.getAttribute('data-view') ?? '').split(',').map(Number);
      return [xmin, ymin];
    };
    const glide = { released: Number.NaN, frames: [] as Array<[number, number]>, resting: false };
    (window as unknown as { glide: typeof glide }).glide = glide;
    let pressed = false;
    el.addEventListener('pointerdown', () => {
      pressed = true;
    });
    el.addEventListener('pointerup', () => {
      pressed = false;
      glide.released = at()[0];
      glide.frames = [];
      glide.resting = false;
      let still = 0;
      const frame = () => {
        const now = at();
        const last = glide.frames[glide.frames.length - 1];
        still = last && last[0] === now[0] ? still + 1 : 0;
        glide.frames.push(now);
        // At rest once it hasn't moved for a quarter second after moving.
        glide.resting = still >= 15 && glide.frames.some(([x]) => x !== glide.released);
        if (!pressed && !glide.resting && glide.frames.length < 400) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  });
}

const glideOf = (page: Page) => page.evaluate(() => (window as unknown as { glide: Glide }).glide);

test.describe('flinging the graph', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch');

  test('a flick glides on in its direction and slows to a stop', async ({ page }) => {
    await openApp(page);
    const before = await view(page);
    await watchGlide(page);
    await flick(page, 20);
    await expect.poll(async () => (await glideOf(page)).resting, { timeout: 10_000 }).toBe(true);
    const { released, frames } = await glideOf(page);
    // Dragged right: the view moves left, and goes on moving after the finger lifts.
    expect(released).toBeLessThan(before[0]);
    expect(frames[frames.length - 1][0]).toBeLessThan(released - 1);
    // Ever slower one way, and only sideways.
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i][0]).toBeLessThanOrEqual(frames[i - 1][0]);
      expect(frames[i][1]).toBeCloseTo(before[2], 6);
    }
  });

  test('a press catches the gliding view, and is no tap', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await watchGlide(page);
    // A fast flick: a long glide to catch.
    const { finger, start } = await flick(page, -40);
    // Once it is on its way.
    await expect
      .poll(async () => {
        const { released, frames } = await glideOf(page);
        return frames.some(([x]) => x > released + 0.5);
      })
      .toBe(true);
    await finger.down(0, start);
    await finger.wait(100);
    const caught = await view(page);
    await finger.up(0, start);
    await page.waitForTimeout(400);
    expect(await view(page)).toEqual(caught);
    // A tap would have put the keypad away.
    await expect(page.getByTestId('keypad')).toBeVisible();
  });

  test('a drag that stops before lifting stays put', async ({ page }) => {
    await openApp(page);
    const g = await box(page.getByTestId('graph'));
    const start = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    const finger = await fingers(page);
    await finger.down(0, start);
    for (let i = 1; i <= 6; i++) {
      await finger.wait(16);
      await finger.move(0, { x: start.x, y: start.y + i * 20 });
    }
    await finger.wait(150);
    await finger.up(0, { x: start.x, y: start.y + 120 });
    await page.waitForTimeout(50);
    const lifted = await view(page);
    await page.waitForTimeout(400);
    expect(await view(page)).toEqual(lifted);
  });

  test('never after a pinch, even when one finger goes on and flicks', async ({ page }) => {
    await openApp(page);
    const g = await box(page.getByTestId('graph'));
    const [x, y] = [g.x + g.width / 2, g.y + g.height / 2];
    const finger = await fingers(page);
    await finger.down(0, { x: x - 20, y });
    await finger.down(1, { x: x + 20, y });
    for (let d = 30; d <= 80; d += 10) {
      await finger.wait(16);
      await finger.move(0, { x: x - d, y });
      await finger.move(1, { x: x + d, y });
    }
    // The second finger lifts; the first goes on alone, and flicks.
    await finger.up(1, { x: x + 80, y });
    for (let i = 1; i <= 6; i++) {
      await finger.wait(16);
      await finger.move(0, { x: x - 80 + i * 20, y });
    }
    await finger.up(0, { x: x + 40, y });
    await page.waitForTimeout(50);
    const lifted = await view(page);
    await page.waitForTimeout(400);
    expect(await view(page)).toEqual(lifted);
  });

  test('not with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await flick(page, 20);
    await page.waitForTimeout(50);
    const lifted = await view(page);
    await page.waitForTimeout(400);
    expect(await view(page)).toEqual(lifted);
  });
});
