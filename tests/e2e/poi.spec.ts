import type { Page } from '@playwright/test';
import {
  colorAt,
  contains,
  countColor,
  expect,
  exprInput,
  openApp,
  RED,
  setExpr,
  test,
  touchSession,
  worldToScreen,
} from './helpers';

/** The points of interest shown, as [name, x, y] from their buttons' labels. */
async function pois(page: Page) {
  const labels = await page
    .getByRole('group', { name: 'Points of interest' })
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  return labels.map((label) => {
    const m = /^(.*) \((-?[\d.]+), (-?[\d.]+)\)$/.exec(label);
    if (!m) throw new Error(`unexpected label ${label}`);
    return [m[1], Number(m[2]), Number(m[3])] as const;
  });
}

const traceStatus = (page: Page) => page.getByTestId('trace').getByRole('status');

async function traceCoords(page: Page) {
  return ((await traceStatus(page).textContent()) ?? '')
    .replace(/[()]/g, '')
    .split(',')
    .map(Number);
}

/** Wait until the graph has drawn what it was told before now (data-view is set when it draws). */
const drawn = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

test.describe('points of interest', () => {
  test('roots, vertex and intercept of y = x^2 - 2', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await expect.poll(async () => (await pois(page)).length).toBe(3);
    const found = await pois(page);
    const roots = found.filter(([name]) => name === 'Root').map(([, x]) => x);
    // ±√2, to the trace's precision.
    expect(roots.sort((a, b) => a - b)).toEqual([
      expect.closeTo(-Math.SQRT2, 3),
      expect.closeTo(Math.SQRT2, 3),
    ]);
    expect(found).toContainEqual(['Local minimum, y-intercept', 0, -2]);
  });

  test('where y = x meets y = 5 - x', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 5 - x');
    await expect.poll(() => pois(page)).toContainEqual(['Intersection with y = x', 2.5, 2.5]);
  });

  test('only the selected curve has them, and Esc puts them away', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    const layer = page.getByRole('group', { name: 'Points of interest' });
    await expect(layer.getByRole('button')).toHaveCount(3);
    // (A mouse resting on the row would keep its curve to the fore.)
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await expect(layer.getByRole('button')).toHaveCount(0);
  });
});

test.describe('points of interest with a mouse', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse');

  test('the trace snaps to a point near the pointer and names it', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 5 - x');
    await expect.poll(async () => (await pois(page)).length).toBeGreaterThan(0);
    const box = await page.getByTestId('graph').boundingBox();
    if (!box) throw new Error('no graph box');
    const p = await worldToScreen(page, 2.5, 2.5);
    await page.mouse.move(box.x + p.sx + 5, box.y + p.sy - 4);
    await expect(traceStatus(page)).toHaveText('(2.5, 2.5)');
    await expect(page.getByTestId('trace').locator('.trace-kind')).toContainText(
      'Intersection with',
    );
    // Away from it, a plain curve point without a name.
    const q = await worldToScreen(page, 1, 1);
    await page.mouse.move(box.x + q.sx, box.y + q.sy);
    await expect.poll(async () => (await traceCoords(page))[0]).toBeCloseTo(1, 1);
    await expect(page.getByTestId('trace').locator('.trace-kind')).toHaveCount(0);
  });

  test('clicking a curve away from its points selects it without pinning', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = sin(x)');
    await setExpr(page, 1, 'y = x/3');
    // The rings of y = x/3, the selected curve, are in.
    await expect.poll(async () => (await pois(page)).length).toBe(3);
    const box = await page.getByTestId('graph').boundingBox();
    if (!box) throw new Error('no graph box');
    // Right on the peak of sin, whose rings are not showing.
    const peak = await worldToScreen(page, Math.PI / 2, 1);
    await page.mouse.click(box.x + peak.sx, box.y + peak.sy);
    await expect(page.locator('.expr-row').first()).toHaveClass(/\bselected\b/);
    // Not pinned: the trace follows the mouse along the curve.
    const q = await worldToScreen(page, -1, Math.sin(-1));
    await page.mouse.move(box.x + q.sx, box.y + q.sy);
    await expect.poll(async () => (await traceCoords(page))[0]).toBeCloseTo(-1, 1);
  });

  test('an intersection ring traces the selected curve', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 5 - x');
    await exprInput(page, 0).click();
    const rows = page.locator('.expr-row');
    await expect(rows.nth(0)).toHaveClass(/\bselected\b/);
    const ring = page.getByRole('button', { name: 'Intersection with y = 5 - x (2.5, 2.5)' });
    await ring.click();
    await expect(traceStatus(page)).toHaveText('(2.5, 2.5)');
    // Still y = x's point, named after the other curve.
    await expect(rows.nth(0)).toHaveClass(/\bselected\b/);
    await expect(page.getByTestId('trace').locator('.trace-meet-text')).toHaveText('y = 5 - x');
    await expect(ring).toHaveClass(/\bcurrent\b/);
    // Esc lets go of the pin along with the selection: hovering traces again.
    await page.keyboard.press('Escape');
    const box = await page.getByTestId('graph').boundingBox();
    if (!box) throw new Error('no graph box');
    const q = await worldToScreen(page, 1, 1);
    await page.mouse.move(box.x + q.sx, box.y + q.sy);
    await expect.poll(async () => (await traceCoords(page))[0]).toBeCloseTo(1, 1);
  });

  test('hovering a curve tints its row', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await setExpr(page, 1, 'y = 3');
    const box = await page.getByTestId('graph').boundingBox();
    if (!box) throw new Error('no graph box');
    const p = await worldToScreen(page, -3, 7);
    await page.mouse.move(box.x + p.sx, box.y + p.sy);
    await expect(page.locator('.expr-row').first()).toHaveClass(/\btraced\b/);
    await expect(page.locator('.expr-row').nth(1)).not.toHaveClass(/\btraced\b/);
  });

  test('picking a curve brings its row into view', async ({ page }) => {
    const rows = ['y = x^2 - 2', ...Array.from({ length: 24 }, (_, i) => `${i} + 1`)];
    await page.addInitScript((sources) => {
      const saved = sources.map((source) => ({
        source,
        colorIndex: -1,
        hidden: false,
        slider: { min: '-10', max: '10', step: '' },
        domain: { min: '0', max: '2pi' },
      }));
      localStorage.setItem('graphing-calc:v1', JSON.stringify({ version: 1, rows: saved }));
    }, rows);
    await openApp(page);
    const first = page.locator('.expr-row').first();
    await exprInput(page, rows.length - 1).click();
    await expect(first).not.toBeInViewport();
    const box = await page.getByTestId('graph').boundingBox();
    if (!box) throw new Error('no graph box');
    const p = await worldToScreen(page, 3, 7);
    await page.mouse.click(box.x + p.sx, box.y + p.sy);
    await expect(first).toBeInViewport();
    await expect(first).toHaveClass(/\bselected\b/);
    await expect(first).toHaveClass(/\bpulse\b/);
  });

  test('clicking a curve selects its row without editing it', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await setExpr(page, 1, 'y = 3');
    const rows = page.locator('.expr-row');
    await expect(rows.nth(1)).toHaveClass(/\bselected\b/);
    const box = await page.getByTestId('graph').boundingBox();
    if (!box) throw new Error('no graph box');
    const p = await worldToScreen(page, 3, 7);
    await page.mouse.click(box.x + p.sx, box.y + p.sy);
    await expect(rows.nth(0)).toHaveClass(/\bselected\b/);
    await expect(rows.nth(1)).not.toHaveClass(/\bselected\b/);
    await expect(exprInput(page, 0)).not.toBeFocused();
    // Its points of interest replace the other row's.
    await expect.poll(async () => (await pois(page)).map(([name]) => name)).toContain('Root');
  });

  test('clicking a point pins the trace there', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    const root = page.getByRole('button', { name: 'Root (1.414, 0)' });
    await root.click();
    await expect(traceStatus(page)).toHaveText('(1.414, 0)');
    await expect(page.getByTestId('trace').locator('.trace-kind')).toHaveText('Root');
    // Pinned: moving away keeps it.
    const box = await page.getByTestId('graph').boundingBox();
    if (!box) throw new Error('no graph box');
    await page.mouse.move(box.x + box.width - 40, box.y + 40);
    await page.waitForTimeout(100);
    await expect(traceStatus(page)).toHaveText('(1.414, 0)');
  });

  test('the keyboard reaches the points from the graph', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await expect.poll(async () => (await pois(page)).length).toBe(3);
    await page.getByTestId('graph').focus();
    await page.keyboard.press('Tab');
    await expect(traceStatus(page)).toBeVisible();
    const first = await traceStatus(page).textContent();
    await page.keyboard.press('ArrowRight');
    await expect(traceStatus(page)).not.toHaveText(first ?? '');
  });

  test('pointing at a row makes its curve stand out', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await setExpr(page, 1, 'y = 3');
    await page.getByTestId('graph').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.expr-row.selected')).toHaveCount(0);
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
    const plain = await countColor(page, RED);
    await page.locator('.expr-row').first().hover();
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(plain * 1.2);
    await page.mouse.move(5, 5);
    await expect.poll(() => countColor(page, RED)).toBeLessThan(plain * 1.1);
  });
});

test.describe('typing keeps the graph and list steady', () => {
  test.skip(({ isMobile }) => isMobile, 'hardware keyboard');

  test('a broken row keeps its color mark and a ghost curve until it is left', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2');
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('button', { name: 'Hide curve' })).toBeVisible();
    await exprInput(page, 0).press('End');
    await exprInput(page, 0).press('+');
    await expect(row.getByRole('alert')).toBeVisible();
    // Still there while the row is being typed in, and its error shows as usual.
    await expect(row.getByRole('button', { name: 'Hide curve' })).toBeVisible();
    // The curve stays as a ghost: there, but in no curve color.
    await drawn(page);
    const [, ghostG] = await colorAt(page, 1.3, 1.69);
    expect(ghostG).toBeLessThan(220);
    expect(await countColor(page, RED)).toBeLessThan(10);
    await exprInput(page, 0).blur();
    await expect(row.getByRole('button', { name: 'Hide curve' })).toHaveCount(0);
    await expect.poll(() => countColor(page, RED)).toBeLessThan(10);
    await expect.poll(async () => (await colorAt(page, 1.3, 1.69))[1]).toBeGreaterThan(230);
  });

  test("a held row's color mark still works", async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2');
    await exprInput(page, 0).press('End');
    await exprInput(page, 0).press('+');
    const row = page.locator('.expr-row').first();
    await row.getByRole('button', { name: 'Hide curve' }).click();
    await expect(row.getByRole('button', { name: 'Show curve' })).toBeVisible();
    await expect(exprInput(page, 0)).toBeFocused();
  });

  test("errors a slider's edit causes wait until it is done", async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    await setExpr(page, 1, 'y = a x');
    const rows = page.locator('.expr-row');
    await exprInput(page, 0).click();
    await exprInput(page, 0).press('End');
    await exprInput(page, 0).press('Backspace');
    await expect(rows.nth(0).getByRole('alert')).toBeVisible();
    // The slider stays, and the curve that uses it shows no error of its own meanwhile.
    await expect(page.getByTestId('slider-a')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(rows.nth(1).getByRole('alert')).toHaveCount(0);
    await exprInput(page, 0).blur();
    await expect(rows.nth(1).getByRole('alert')).toContainText("Depends on 'a'");
    await expect(page.getByTestId('slider-a')).toHaveCount(0);
  });
});

test.describe('points of interest by touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch');

  /** Put the keypad away (a tap on empty graph), so the graph keeps its size. */
  async function settle(page: Page) {
    const graph = page.getByTestId('graph');
    await graph.tap({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('keypad')).toHaveCount(0);
  }

  test('a tap near a point selects the curve and pins its name', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await settle(page);
    // The tap away from the curve deselected it.
    await expect(page.locator('.expr-row.selected')).toHaveCount(0);
    const p = await worldToScreen(page, Math.SQRT2, 0);
    await page.getByTestId('graph').tap({ position: { x: p.sx + 6, y: p.sy - 5 } });
    await expect(page.locator('.expr-row').first()).toHaveClass(/\bselected\b/);
    await expect(traceStatus(page)).toHaveText('(1.414, 0)');
    await expect(page.getByTestId('trace').locator('.trace-kind')).toHaveText('Root');
    await expect(page.getByTestId('keypad')).toHaveCount(0);
  });

  test('dragging the pinned dot scrubs along the curve instead of panning', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await settle(page);
    const graph = page.getByTestId('graph');
    const box = await graph.boundingBox();
    if (!box) throw new Error('no graph box');
    const view = await graph.getAttribute('data-view');
    const p = await worldToScreen(page, 1, -1);
    await graph.tap({ position: { x: p.sx, y: p.sy } });
    await expect(traceStatus(page)).toBeVisible();
    const touch = await touchSession(page);
    const start = { x: box.x + p.sx, y: box.y + p.sy };
    await touch.start(start);
    for (let i = 1; i <= 6; i++) await touch.move({ x: start.x - i * 10, y: start.y });
    await touch.end();
    await drawn(page);
    expect(await graph.getAttribute('data-view')).toBe(view);
    const [x, y] = await traceCoords(page);
    expect(x).toBeLessThan(0.5);
    expect(y).toBeCloseTo(x * x - 2, 2);
  });

  test('holding on a curve picks it up to scrub', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await settle(page);
    const graph = page.getByTestId('graph');
    const box = await graph.boundingBox();
    if (!box) throw new Error('no graph box');
    const view = await graph.getAttribute('data-view');
    const p = await worldToScreen(page, -1, -1);
    const touch = await touchSession(page);
    const start = { x: box.x + p.sx, y: box.y + p.sy };
    await touch.start(start);
    // Picked up once the hold has gone on long enough.
    await expect(traceStatus(page)).toBeVisible();
    await expect(page.getByTestId('trace')).toHaveClass(/\bscrubbing\b/);
    for (let i = 1; i <= 6; i++) await touch.move({ x: start.x + i * 10, y: start.y });
    await touch.end();
    await drawn(page);
    expect(await graph.getAttribute('data-view')).toBe(view);
    await expect(page.locator('.expr-row').first()).toHaveClass(/\bselected\b/);
    const [x, y] = await traceCoords(page);
    expect(x).toBeGreaterThan(-0.5);
    expect(y).toBeCloseTo(x * x - 2, 2);
  });

  test('a hold on a curve puts the keypad away like a tap', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await setExpr(page, 1, 'y = 4 - x');
    await expect(page.getByTestId('keypad')).toBeVisible();
    const graph = page.getByTestId('graph');
    const box = await graph.boundingBox();
    if (!box) throw new Error('no graph box');
    const p = await worldToScreen(page, -2, 2);
    const touch = await touchSession(page);
    await touch.start({ x: box.x + p.sx, y: box.y + p.sy });
    await expect(page.locator('.expr-row').first()).toHaveClass(/\bselected\b/);
    await touch.end();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await expect(exprInput(page, 1)).not.toBeFocused();
  });

  test('a tap near the pinned dot still taps', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await settle(page);
    const graph = page.getByTestId('graph');
    const p = await worldToScreen(page, 1, -1);
    await graph.tap({ position: { x: p.sx, y: p.sy } });
    await expect(traceStatus(page)).toBeVisible();
    await expect(page.getByTestId('trace').locator('.trace-kind')).toHaveCount(0);
    const pinned = await traceStatus(page).textContent();
    // The root's ring, a little over a finger's snap away from the pinned dot.
    const root = await worldToScreen(page, Math.SQRT2, 0);
    expect(Math.hypot(root.sx - p.sx, root.sy - p.sy)).toBeLessThan(24);
    await graph.tap({ position: { x: root.sx, y: root.sy } });
    await expect(traceStatus(page)).toHaveText('(1.414, 0)');
    await expect(page.getByTestId('trace').locator('.trace-kind')).toHaveText('Root');
    // Pinned off any point, the pin stays put when the view changes.
    await graph.tap({ position: { x: p.sx, y: p.sy } });
    await expect(traceStatus(page)).toHaveText(pinned ?? '');
    await page.getByRole('button', { name: 'Zoom out' }).tap();
    await page.waitForTimeout(500);
    await expect(traceStatus(page)).toHaveText(pinned ?? '');
    await expect(page.getByTestId('trace').locator('.trace-kind')).toHaveCount(0);
  });

  test('the trace label stays inside the graph', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 5 - x');
    await settle(page);
    const graph = page.getByTestId('graph');
    const p = await worldToScreen(page, 2.5, 2.5);
    await graph.tap({ position: { x: p.sx, y: p.sy } });
    await expect(page.getByTestId('trace').locator('.trace-kind')).toContainText(
      'Intersection with',
    );
    const graphBox = await graph.boundingBox();
    const pill = await page.locator('.trace-pill').boundingBox();
    if (!graphBox || !pill) throw new Error('no box');
    expect(contains(graphBox, pill)).toBe(true);
  });
});
