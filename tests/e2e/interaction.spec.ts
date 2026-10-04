import { expect, exprInput, openApp, setExpr, test, worldToScreen } from './helpers';

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
    await expect
      .poll(async () => (await view(page))[1] - (await view(page))[0])
      .toBeLessThan((before[1] - before[0]) * 0.9);

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

  const width = async (page: import('@playwright/test').Page) => {
    const v = await view(page);
    return v[1] - v[0];
  };
  const centerX = async (page: import('@playwright/test').Page) => {
    const v = await view(page);
    return (v[0] + v[1]) / 2;
  };

  test('double-clicking the zoom buttons zooms twice and does not zoom the graph', async ({
    page,
  }) => {
    await openApp(page);
    const w0 = await width(page);
    await page.getByRole('button', { name: 'Zoom out' }).dblclick();
    await expect.poll(() => width(page)).toBeCloseTo(w0 * 4, 3);
    await page.waitForTimeout(300);
    expect(await width(page)).toBeCloseTo(w0 * 4, 3);
    expect(await centerX(page)).toBeCloseTo(0, 6);

    await page.getByRole('button', { name: 'Zoom in' }).dblclick();
    await expect.poll(() => width(page)).toBeCloseTo(w0, 3);
    await page.waitForTimeout(300);
    expect(await width(page)).toBeCloseTo(w0, 3);
    expect(await centerX(page)).toBeCloseTo(0, 6);

    await page.getByTestId('graph').focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Reset view' }).dblclick();
    await page.waitForTimeout(400);
    expect(await width(page)).toBeCloseTo(w0, 3);
    expect(await centerX(page)).toBeCloseTo(0, 6);
  });

  test('keyboard zooms compose, and input during a zoom is kept', async ({ page }) => {
    await openApp(page);
    const graph = page.getByTestId('graph');
    const w0 = await width(page);
    await graph.focus();
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await expect.poll(() => width(page)).toBeCloseTo(w0 / 4, 3);

    await page.keyboard.press('0');
    await expect.poll(() => width(page)).toBeCloseTo(w0, 3);
    const px = await graph.evaluate((el) => el.getBoundingClientRect().width);
    await page.keyboard.press('+');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    expect(await width(page)).toBeCloseTo(w0 / 2, 3);
    // Three 40px steps at the zoomed-in scale.
    expect(await centerX(page)).toBeCloseTo((3 * 40 * (w0 / 2)) / px, 3);
  });

  test('a mouse click traces like hovering and does not pin', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 5 - x');
    const box = await page.getByTestId('graph').boundingBox();
    if (!box) throw new Error('no graph box');
    const label = page.getByTestId('trace').getByRole('status');
    const coords = async () =>
      ((await label.textContent()) ?? '').replace(/[()]/g, '').split(',').map(Number);
    const a = await worldToScreen(page, 1, 1);
    await page.mouse.click(box.x + a.sx, box.y + a.sy);
    await expect(label).toBeVisible();
    const b = await worldToScreen(page, 2, 3);
    await page.mouse.move(box.x + b.sx, box.y + b.sy);
    await expect.poll(async () => (await coords())[0]).toBeCloseTo(2, 0);
    expect((await coords())[1]).toBeCloseTo(3, 0);
    await page.mouse.move(box.x - 40, box.y + 40);
    await expect(page.getByTestId('trace')).toHaveCount(0);
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

test.describe('touch interaction', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch');

  test('a pinned trace goes away with its row', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    const graph = page.getByTestId('graph');
    await graph.tap({ position: { x: 5, y: 5 } }); // dismiss the keypad first
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    const { sx, sy } = await worldToScreen(page, 1, 1);
    await graph.tap({ position: { x: sx, y: sy } });
    await expect(page.getByTestId('trace').getByRole('status')).toBeVisible();
    await page.getByRole('button', { name: 'Hide curve' }).tap();
    await expect(page.getByTestId('trace')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show curve' }).tap();
    await page.waitForTimeout(200);
    await expect(page.getByTestId('trace')).toHaveCount(0);
    await expect(exprInput(page, 0)).toHaveValue('y = x');
  });
});
