import {
  AXIS,
  AXIS_DARK,
  countColor,
  expect,
  exprInput,
  openApp,
  RED,
  RED_DARK,
  setExpr,
  test,
} from './helpers';

test('app loads with an empty expression row and a graph', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle('Graphing Calculator');
  await expect(exprInput(page, 0)).toHaveAttribute('placeholder', 'Try y = sin(x)');
  // Axes are drawn even with nothing typed.
  await expect.poll(() => countColor(page, AXIS, 20)).toBeGreaterThan(100);
});

test('typing y = x^2 draws a curve', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'y = x^2');
  await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
});

test('a syntax error is shown after a pause', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'y = (x');
  const row = page.locator('.expr-row').first();
  await expect(row.getByRole('alert')).toContainText("Missing ')'");
  await setExpr(page, 0, 'y = (x)');
  await expect(row.getByRole('alert')).toHaveCount(0);
});

test('Enter adds a row and Backspace on an empty row removes it', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'y = x');
  await exprInput(page, 0).press('Enter');
  await expect(exprInput(page, 1)).toBeFocused();
  await setExpr(page, 1, 'y = 2');
  await exprInput(page, 1).press('Enter');
  await expect(exprInput(page, 2)).toBeFocused();
  await expect(page.getByTestId('expr-input')).toHaveCount(3);
  await exprInput(page, 2).press('ArrowUp');
  await expect(exprInput(page, 1)).toBeFocused();
  await exprInput(page, 1).fill('');
  await exprInput(page, 1).press('Backspace');
  await expect(exprInput(page, 0)).toBeFocused();
  await expect(page.getByTestId('expr-input')).toHaveCount(2);
});

test('the swatch toggles curve visibility', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'y = x^2');
  await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Hide curve' }).click();
  await expect.poll(() => countColor(page, RED)).toBeLessThan(10);
  await page.getByRole('button', { name: 'Show curve' }).click();
  await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
});

test('constants show their value', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, '2^10 + 0.1 + 0.2');
  await expect(page.locator('.expr-value').first()).toHaveText('= 1024.3');
});

test.describe('dark color scheme', () => {
  test.use({ colorScheme: 'dark' });

  test('the app, the graph and its curves are dark', async ({ page }) => {
    await openApp(page);
    const dark = await page.evaluate(() =>
      [document.body, document.querySelector('.panel')].map((el) =>
        (getComputedStyle(el as Element).backgroundColor.match(/\d+/g) ?? []).map(Number),
      ),
    );
    for (const [r, g, b] of dark) expect(Math.max(r, g, b)).toBeLessThan(40);
    await expect.poll(() => countColor(page, AXIS_DARK, 20)).toBeGreaterThan(100);
    await setExpr(page, 0, 'y = x^2');
    await expect.poll(() => countColor(page, RED_DARK)).toBeGreaterThan(200);
  });

  test('a syntax error is shown after a pause', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = (x');
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('alert')).toContainText("Missing ')'");
    await setExpr(page, 0, 'y = (x)');
    await expect(row.getByRole('alert')).toHaveCount(0);
  });

  test('the swatch toggles curve visibility', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2');
    await expect.poll(() => countColor(page, RED_DARK)).toBeGreaterThan(200);
    await page.getByRole('button', { name: 'Hide curve' }).click();
    await expect.poll(() => countColor(page, RED_DARK)).toBeLessThan(10);
    await page.getByRole('button', { name: 'Show curve' }).click();
    await expect.poll(() => countColor(page, RED_DARK)).toBeGreaterThan(200);
  });
});
