import { countColorNear, expect, exprInput, openApp, RED, setExpr, test } from './helpers';

test('a slider moves the curves that use it', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'a = 1');
  await setExpr(page, 1, 'y = a');
  const slider = page.getByTestId('slider-a');
  await expect(slider).toBeVisible();
  // The slider takes no color: the curve is the first one, so red.
  await expect.poll(() => countColorNear(page, 0.5, 1, RED)).toBeGreaterThan(5);

  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(exprInput(page, 0)).toHaveValue('a = 5');
  await expect.poll(() => countColorNear(page, 0.5, 5, RED)).toBeGreaterThan(5);
  await expect.poll(() => countColorNear(page, 0.5, 1, RED)).toBe(0);
});

test('user functions can be defined and called', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'f(x) = x^2');
  await setExpr(page, 1, 'g(u) = u + 3');
  await setExpr(page, 2, 'y = g(f(x - 1))');
  // Vertex of (x-1)^2 + 3 is at (1, 3); the definitions take no color, so the curve is red.
  await expect.poll(() => countColorNear(page, 1, 3, RED)).toBeGreaterThan(5);
  await expect.poll(() => countColorNear(page, 1, 0, RED)).toBe(0);
});

test('unknown names offer to add sliders', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'y = m x + b');
  const fix = page.getByRole('button', { name: /Add sliders: m, b/ });
  await expect(fix).toBeVisible();
  await fix.click();
  await expect(exprInput(page, 1)).toHaveValue('m = 1');
  await expect(exprInput(page, 2)).toHaveValue('b = 1');
  await expect(page.locator('.expr-row').first().getByRole('alert')).toHaveCount(0);
});

test('circular definitions are reported', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'a = b + 1');
  await setExpr(page, 1, 'b = a');
  await expect(page.locator('.expr-row').first().getByRole('alert')).toContainText(/ircular/);
});

test('derived variables show their value', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'a = 3');
  await setExpr(page, 1, 'c = a^2 + 1');
  await expect(page.locator('.expr-row').nth(1).locator('.expr-value')).toHaveText('= 10');
});
