import type { Locator, Page } from '@playwright/test';
import { expect, exprInput, openApp, test, touchSession } from './helpers';

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

/**
 * A quick flick across the graph's middle, 20px every frame, still moving as it lets go: it
 * lifts right after its last move.
 */
async function flick(page: Page, dx: number) {
  const g = await box(page.getByTestId('graph'));
  const start = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  const touch = await touchSession(page);
  await touch.start(start);
  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(16);
    await touch.move({ x: start.x + i * dx, y: start.y });
  }
  await touch.end();
  return { touch, start };
}

test.describe('flinging the graph', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch');

  test('a flick glides on in its direction and slows to a stop', async ({ page }) => {
    await openApp(page);
    const before = await view(page);
    await flick(page, 20);
    const released = (await view(page))[0];
    // Dragged right: the view moves left, and goes on moving after the finger lifts.
    expect(released).toBeLessThan(before[0]);
    await expect.poll(async () => (await view(page))[0]).toBeLessThan(released - 1);
    let last = Number.NaN;
    await expect
      .poll(
        async () => {
          const now = (await view(page))[0];
          const resting = now === last;
          last = now;
          return resting;
        },
        { intervals: [250] },
      )
      .toBe(true);
    // Only sideways.
    expect((await view(page))[2]).toBeCloseTo(before[2], 6);
  });

  test('a press catches the gliding view, and is no tap', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    const { touch, start } = await flick(page, -20);
    const released = await view(page);
    await page.waitForTimeout(30);
    await touch.start(start);
    await page.waitForTimeout(100);
    const caught = await view(page);
    await touch.end();
    expect(caught[0]).toBeGreaterThan(released[0]);
    await page.waitForTimeout(400);
    expect(await view(page)).toEqual(caught);
    // A tap would have put the keypad away.
    await expect(page.getByTestId('keypad')).toBeVisible();
  });

  test('a drag that stops before lifting stays put', async ({ page }) => {
    await openApp(page);
    const g = await box(page.getByTestId('graph'));
    const start = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    const touch = await touchSession(page);
    await touch.start(start);
    for (let i = 1; i <= 6; i++) await touch.move({ x: start.x, y: start.y + i * 20 });
    await page.waitForTimeout(150);
    await touch.end();
    await page.waitForTimeout(50);
    const lifted = await view(page);
    await page.waitForTimeout(400);
    expect(await view(page)).toEqual(lifted);
  });

  test('never after a pinch, even when one finger goes on and flicks', async ({ page }) => {
    await openApp(page);
    const g = await box(page.getByTestId('graph'));
    const [x, y] = [g.x + g.width / 2, g.y + g.height / 2];
    const touch = await touchSession(page);
    await touch.start({ x: x - 20, y }, { x: x + 20, y });
    for (let d = 30; d <= 80; d += 10) await touch.move({ x: x - d, y }, { x: x + d, y });
    // The second finger lifts (a move that leaves it out); the first flicks on alone.
    await touch.move({ x: x - 80, y });
    for (let i = 1; i <= 6; i++) {
      await page.waitForTimeout(16);
      await touch.move({ x: x - 80 + i * 20, y });
    }
    await touch.end();
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
