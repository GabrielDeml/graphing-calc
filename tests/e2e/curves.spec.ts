import { colorAt, countColorNear, expect, openApp, RED, setExpr, test } from './helpers';

function isBackground([r, g, b]: [number, number, number], dark = false) {
  return dark ? r < 40 && g < 40 && b < 45 : r > 235 && g > 235 && b > 235;
}

test('parametric circle', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, '(2cos t, 2sin t)');
  await expect.poll(() => countColorNear(page, 0, 2, RED)).toBeGreaterThan(5);
  await expect.poll(() => countColorNear(page, -2, 0, RED)).toBeGreaterThan(5);
  await expect.poll(() => countColorNear(page, 0, 0, RED)).toBe(0);
  await expect(page.locator('.range-control')).toBeVisible();
});

test('polar rose', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'r = 3cos(2θ)');
  await expect.poll(() => countColorNear(page, 3, 0, RED)).toBeGreaterThan(5);
});

test('x = f(y)', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'x = y^2');
  await expect.poll(() => countColorNear(page, 4, 2, RED)).toBeGreaterThan(5);
  await expect.poll(() => countColorNear(page, 4, -2, RED)).toBeGreaterThan(5);
});

test('points', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, '(1, 2), (-3, 4)');
  await expect.poll(() => countColorNear(page, 1, 2, RED, 4)).toBeGreaterThan(10);
  await expect.poll(() => countColorNear(page, -3, 4, RED, 4)).toBeGreaterThan(10);
});

test('implicit circle', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'x^2 + y^2 = 9');
  await expect.poll(() => countColorNear(page, 3, 0, RED)).toBeGreaterThan(5);
  await expect.poll(() => countColorNear(page, 0, -3, RED)).toBeGreaterThan(5);
  await expect.poll(() => countColorNear(page, 0, 0, RED)).toBe(0);
});

test('implicit inequality shades the inside only', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'x^2 + y^2 < 4');
  await expect.poll(async () => isBackground(await colorAt(page, 0.5, 0.5))).toBe(false);
  expect(isBackground(await colorAt(page, 4.5, 4.5))).toBe(true);
});

test('explicit inequality shades one side', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'y > x');
  await expect.poll(async () => isBackground(await colorAt(page, -2.5, 2.5))).toBe(false);
  expect(isBackground(await colorAt(page, 2.5, -2.5))).toBe(true);
});

test('asymptotes are not bridged', async ({ page }) => {
  await openApp(page);
  await setExpr(page, 0, 'y = 1/x');
  await expect.poll(() => countColorNear(page, 1, 1, RED)).toBeGreaterThan(5);
  // A vertical connector at x = 0 would color pixels on the y-axis far from the curve.
  expect(await countColorNear(page, 0, 4, RED, 3)).toBe(0);
  expect(await countColorNear(page, 0, -4, RED, 3)).toBe(0);
});
