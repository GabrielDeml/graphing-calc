import { expect, openApp, setExpr, test, worldToScreen } from './helpers';

test.describe('desktop interaction', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse interactions');

  const view = async (page: import('@playwright/test').Page) =>
    ((await page.getByTestId('graph').getAttribute('data-view')) ?? '').split(',').map(Number);

  test('wheel zooms around the cursor and drag pans', async ({ page }) => {
    await openApp(page);
    const graph = page.getByTestId('graph');
    const box = await graph.boundingBox();
    if (!box) throw new Error('no graph box');
    const before = await view(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await view(page))[1] - (await view(page))[0]).toBeLessThan(
      (before[1] - before[0]) * 0.9,
    );

    const zoomed = await view(page);
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 250, { steps: 5 });
    await page.mouse.up();
    const panned = await view(page);
    // Dragging right moves the view left (content follows the pointer).
    expect(panned[0]).toBeLessThan(zoomed[0]);
    expect(panned[2]).toBeGreaterThan(zoomed[2]);
  });

  test('zoom buttons and reset', async ({ page }) => {
    await openApp(page);
    const before = await view(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => (await view(page))[1]).toBeLessThan(before[1] * 0.6);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect.poll(async () => (await view(page))[1]).toBeCloseTo(before[1], 1);
  });

  test('hovering a curve shows its coordinates', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    const graph = page.getByTestId('graph');
    const box = await graph.boundingBox();
    if (!box) throw new Error('no graph box');
    const { sx, sy } = await worldToScreen(page, 1, 1);
    await page.mouse.move(box.x + sx, box.y + sy + 3);
    const label = page.getByTestId('trace').getByRole('status');
    await expect(label).toBeVisible();
    const [x, y] = ((await label.textContent()) ?? '').replace(/[()]/g, '').split(',').map(Number);
    expect(x).toBeCloseTo(1, 1);
    expect(y).toBeCloseTo(1, 1);
    await page.mouse.move(box.x + 5, box.y + box.height - 5);
    await expect(page.getByTestId('trace')).toHaveCount(0);
  });
});
