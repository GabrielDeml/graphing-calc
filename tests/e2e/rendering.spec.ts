import { BLUE, countColor, expect, exprInput, setExpr, test } from './helpers';

async function openDebug(page: import('@playwright/test').Page) {
  await page.goto('/?debug');
  await expect(exprInput(page, 0)).toBeVisible();
  await expect(page.getByTestId('graph')).toHaveAttribute('data-view', /,/);
}

const frameMs = async (page: import('@playwright/test').Page) =>
  Number.parseFloat((await page.locator('.debug-overlay').textContent()) ?? 'NaN');

test.describe('rendering', () => {
  test.skip(({ isMobile }) => isMobile, 'one project is enough for these');

  test('redrawing a cached shaded region is fast', async ({ page }) => {
    await openDebug(page);
    await setExpr(page, 0, 'sin(x) + sin(y) > 0');
    await setExpr(page, 1, 'y = x');
    await expect.poll(() => countColor(page, BLUE)).toBeGreaterThan(500);
    const shown = await countColor(page, BLUE);
    // Hiding the other row redraws the region from its cached geometry; that used to cost
    // ~450ms of path building (a closePath per marching-squares polygon).
    await page.getByRole('button', { name: 'Hide curve' }).nth(1).click();
    await expect.poll(() => countColor(page, BLUE)).toBeLessThan(shown / 5);
    expect(await frameMs(page)).toBeLessThan(100);
  });

  test('a playing slider samples dependent rows at interactive quality', async ({ page }) => {
    await openDebug(page);
    await setExpr(page, 0, 'a = 1');
    await setExpr(page, 1, 'sin(a x y) = 0.5');
    const overlay = page.locator('.debug-overlay');
    await expect(overlay).toContainText('final');
    await page.getByRole('button', { name: 'Play a' }).click();
    await expect(overlay).toContainText('interactive');
    await page.getByRole('button', { name: 'Pause a' }).click();
    // Settles to a final render once the values stop changing.
    await expect(overlay).toContainText('final');
  });
});

test('the canvas renders at the device pixel ratio, edge to edge', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('graph')).toHaveAttribute('data-view', /,/);
  const info = await page.locator('canvas.graph-canvas').evaluate((c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect();
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const last = ctx.getImageData(0, c.height - 1, c.width, 1).data;
    let light = 0;
    for (let i = 0; i < last.length; i += 4) {
      if (last[i] > 230 && last[i + 1] > 230 && last[i + 2] > 230) light++;
    }
    return {
      width: c.width,
      height: c.height,
      cssWidth: r.width,
      cssHeight: r.height,
      dpr: devicePixelRatio,
      light: light / c.width,
    };
  });
  // The e2e mobile project emulates a 2.625x screen; desktop is 1x.
  expect(Math.abs(info.width - info.cssWidth * info.dpr)).toBeLessThanOrEqual(1);
  expect(Math.abs(info.height - info.cssHeight * info.dpr)).toBeLessThanOrEqual(1);
  // The bottom device row is painted with the background like the rest (light mode).
  expect(info.light).toBeGreaterThan(0.85);
});
