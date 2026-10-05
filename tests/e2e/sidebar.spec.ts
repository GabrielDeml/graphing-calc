import { expect, openApp, test } from './helpers';

const KEY = 'graphing-calc:v1';

test.describe('the list beside the graph', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('is 400px wide, and dragging or arrowing its edge resizes it for good', async ({ page }) => {
    await openApp(page);
    const panel = page.locator('.panel');
    const width = async () => (await panel.boundingBox())?.width ?? 0;
    expect(await width()).toBeCloseTo(400, 0);

    const edge = page.getByRole('separator', { name: 'Resize expression list' });
    const box = await edge.boundingBox();
    if (!box) throw new Error('no resize handle');
    const x = box.x + box.width / 2;
    await page.mouse.move(x, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(x + 80, box.y + 300, { steps: 5 });
    await page.mouse.up();
    await expect.poll(width).toBeCloseTo(480, 0);
    await expect(edge).toHaveAttribute('aria-valuenow', '480');

    await edge.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(width).toBeCloseTo(464, 0);
    // The graph keeps its room, and the list its minimum.
    await page.keyboard.press('End');
    await expect.poll(width).toBeCloseTo(640, 0);
    await page.keyboard.press('Home');
    await expect.poll(width).toBeCloseTo(300, 0);
    await page.keyboard.press('ArrowRight');

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), KEY))
      .toContain('"sidebarWidth":316');
    await page.reload();
    await openApp(page);
    await expect.poll(width).toBeCloseTo(316, 0);

    // Double-click puts the default back.
    await edge.dblclick();
    await expect.poll(width).toBeCloseTo(400, 0);
  });
});
