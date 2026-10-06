import { countColorNear, expect, exprInput, GREEN, openApp, RED, setExpr, test } from './helpers';

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
  // Vertex of (x-1)^2 + 3 is at (1, 3); the third row is green.
  await expect.poll(() => countColorNear(page, 1, 3, GREEN)).toBeGreaterThan(5);
  await expect.poll(() => countColorNear(page, 1, 0, GREEN)).toBe(0);
});

test('unknown names become sliders on Enter, and Undo brings the offer back', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'y = m x + b');
  await exprInput(page, 0).press('Enter');
  await expect(exprInput(page, 1)).toHaveValue('m = 1');
  await expect(exprInput(page, 2)).toHaveValue('b = 1');
  await expect(exprInput(page, 3)).toBeFocused();
  await expect(page.locator('.expr-row').first().getByRole('alert')).toHaveCount(0);
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('Added sliders m, b');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('expr-input')).toHaveCount(2);
  await expect(exprInput(page, 0)).toHaveValue('y = m x + b');
  // The one-tap way stays.
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
  // Enter makes the `b = 1` slider right away (leaving the row would make it a moment later,
  // racing the next fill); then turn that slider into the circular definition.
  await exprInput(page, 0).press('Enter');
  await expect(exprInput(page, 1)).toHaveValue('b = 1');
  await setExpr(page, 1, 'b = a');
  await expect(page.locator('.expr-row').first().getByRole('alert')).toContainText(/ircular/);
});

test('derived variables show their value', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'a = 3');
  await setExpr(page, 1, 'c = a^2 + 1');
  await expect(page.locator('.expr-row').nth(1).locator('.expr-value')).toHaveText('= 10');
});
