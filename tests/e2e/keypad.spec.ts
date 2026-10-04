import { countColor, expect, exprInput, openApp, RED, test } from './helpers';

test.describe('math keypad on touch devices', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');

  test('panel sits below the graph and snaps', async ({ page }) => {
    await openApp(page);
    const graph = await page.getByTestId('graph').boundingBox();
    const panel = await page.locator('.panel').boundingBox();
    expect(graph && panel && panel.y >= graph.y + graph.height - 1).toBe(true);
    await page.locator('.panel-title').tap();
    await expect(page.locator('.app')).toHaveAttribute('data-panel', 'full');
    await page.locator('.panel-title').tap();
    await expect(page.locator('.app')).toHaveAttribute('data-panel', 'collapsed');
  });

  test('tapping a row opens our keypad instead of the device keyboard', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await expect(exprInput(page, 0)).toHaveAttribute('inputmode', 'none');
    await expect(exprInput(page, 0)).toBeFocused();
  });

  test('typing with keys draws a curve and keeps focus', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    for (const id of ['y', 'eq', 'x', 'pow', '2']) {
      await page.getByTestId(new RegExp(`^key-${id}$`)).first().tap();
      await expect(exprInput(page, 0)).toBeFocused();
    }
    await expect(exprInput(page, 0)).toHaveValue('y=x^2');
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
  });

  test('function keys, smart backspace and enter', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await page.getByTestId('key-sqrt').first().tap();
    await expect(exprInput(page, 0)).toHaveValue('sqrt()');
    await page.getByTestId('key-backspace').first().tap();
    await expect(exprInput(page, 0)).toHaveValue('');

    await page.getByTestId('keypad-tab-fx').tap();
    await page.getByTestId('key-sin').tap();
    await page.getByTestId('keypad-tab-123').tap();
    await page.getByTestId('key-x').tap();
    await expect(exprInput(page, 0)).toHaveValue('sin(x)');
    await page.getByTestId('key-enter').first().tap();
    await expect(exprInput(page, 1)).toBeFocused();
  });

  test('hiding the keypad gives the graph more room', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    const withKeypad = await page.getByTestId('graph').boundingBox();
    await page.getByTestId('keypad-hide').tap();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await expect(exprInput(page, 0)).toBeFocused();
    const without = await page.getByTestId('graph').boundingBox();
    expect((without?.height ?? 0) > (withKeypad?.height ?? 0)).toBe(true);
  });
});

test.describe('math keypad on desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('hidden by default and toggled from the header', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).click();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await expect(exprInput(page, 0)).toHaveAttribute('inputmode', 'text');
    await page.getByTestId('keypad-toggle').click();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await page.getByTestId('key-7').first().click();
    await expect(exprInput(page, 0)).toHaveValue('7');
  });
});
