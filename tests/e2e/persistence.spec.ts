import type { Page } from '@playwright/test';
import { countColorNear, expect, exprInput, GREEN, openApp, setExpr, test } from './helpers';

const KEY = 'graphing-calc:v1';
const PURPLE = '#6042a6';

const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

/** Put `value` in storage before the app loads (on every load of this page). */
async function seed(page: Page, value: string) {
  await page.addInitScript(([key, v]) => localStorage.setItem(key, v), [KEY, value] as const);
}

const savedRow = (source: string, extra: Record<string, unknown> = {}) => ({
  source,
  colorIndex: -1,
  hidden: false,
  slider: { min: '-10', max: '10', step: '' },
  domain: { min: '0', max: '2pi' },
  ...extra,
});

/** Fire the page's "hidden" event, as when a phone switches apps, without leaving the page. */
const hide = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Reflect.deleteProperty(document, 'visibilityState');
  });

/** Graph pixels per world unit, from the graph's data-view. */
const scale = (page: Page) =>
  page.getByTestId('graph').evaluate((el) => {
    const [xmin, xmax] = (el.getAttribute('data-view') ?? '').split(',').map(Number);
    return el.clientWidth / (xmax - xmin);
  });

test('a visit that changes nothing stores nothing', async ({ page }) => {
  await openApp(page);
  await exprInput(page, 0).click();
  await page.waitForTimeout(700);
  expect(await stored(page)).toBeNull();
});

test('a seeded session is restored: rows, colors, sliders and the view', async ({ page }) => {
  await seed(
    page,
    JSON.stringify({
      version: 1,
      rows: [
        savedRow('b = 3', { slider: { min: '0', max: '5', step: '1' } }),
        savedRow('y = b', { colorIndex: 2 }),
        savedRow('y = -b', { colorIndex: 1, hidden: true }),
      ],
      view: { cx: 4, cy: 2, ppuX: 50, ppuY: 50 },
    }),
  );
  await openApp(page);
  await expect(page.getByTestId('expr-input')).toHaveCount(4);
  await expect(exprInput(page, 0)).toHaveValue('b = 3');
  await expect(exprInput(page, 1)).toHaveValue('y = b');
  await expect(exprInput(page, 2)).toHaveValue('y = -b');
  await expect(exprInput(page, 3)).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'b slider maximum' })).toHaveValue('5');
  await expect(page.getByTestId('slider-b')).toHaveJSProperty('value', '3');
  await expect(page.getByRole('button', { name: 'Show curve' })).toBeVisible();
  const [xmin, xmax, ymin, ymax] = (
    (await page.getByTestId('graph').getAttribute('data-view')) ?? ''
  )
    .split(',')
    .map(Number);
  expect((xmin + xmax) / 2).toBeCloseTo(4, 3);
  expect((ymin + ymax) / 2).toBeCloseTo(2, 3);
  expect(await scale(page)).toBeCloseTo(50, 3);
  await expect.poll(() => countColorNear(page, 4, 3, GREEN)).toBeGreaterThan(5);
});

const corrupt: ReadonlyArray<readonly [string, string]> = [
  ['broken JSON', '{"version":1,"rows":[{"source":"y = x'],
  ['the wrong shape', '{"version":1,"rows":{"0":"y = x"}}'],
  ['an unknown old version', '{"version":0,"rows":[]}'],
];

for (const [label, value] of corrupt) {
  test(`storage with ${label} starts an empty graph, quietly`, async ({ page }) => {
    await seed(page, value);
    await openApp(page);
    await expect(page.getByTestId('expr-input')).toHaveCount(1);
    await expect(exprInput(page, 0)).toHaveValue('');
    await expect(exprInput(page, 0)).toHaveAttribute('placeholder', 'Try y = sin(x)');
    // The first edit saves over it.
    await setExpr(page, 0, 'y = x');
    await expect.poll(() => stored(page)).toContain('"y = x"');
  });
}

test('storage from a newer version of the app is left alone', async ({ page }) => {
  const newer = '{"version":7,"rows":[{"source":"y = x"}],"more":true}';
  await seed(page, newer);
  await openApp(page);
  await expect(page.getByTestId('expr-input')).toHaveCount(1);
  await setExpr(page, 0, 'y = 2');
  await expect(page.getByTestId('expr-input')).toHaveCount(2);
  await hide(page);
  await page.waitForTimeout(700);
  expect(await stored(page)).toBe(newer);
});

test('blocked storage still runs, without saving or errors', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await openApp(page);
  await setExpr(page, 0, 'y = x');
  await expect(page.getByTestId('expr-input')).toHaveCount(2);
  await page.waitForTimeout(700);
});

test.describe('autosave on desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse and hardware keyboard');

  test('a reload restores rows, colors and slider settings, paused', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 2');
    await setExpr(page, 1, 'y = a x');
    const max = page.getByRole('textbox', { name: 'a slider maximum' });
    await max.fill('20');
    await max.press('Enter');
    await page
      .locator('.expr-row')
      .nth(1)
      .getByRole('button', { name: 'Change color', exact: true })
      .click();
    await page.getByRole('button', { name: 'Purple', exact: true }).click();
    await expect.poll(() => stored(page)).toContain('"colorIndex":3');
    // The keypad mode is the device default until it is picked with ⌨: not saved.
    expect(await stored(page)).not.toContain('keypad');
    // Playing: saved when the page goes away, and restored paused.
    await page.getByRole('button', { name: 'Play a' }).click();
    await expect.poll(() => exprInput(page, 0).inputValue()).not.toBe('a = 2');
    await page.reload();
    await expect(exprInput(page, 0)).toHaveValue(/^a = -?[\d.]+$/);
    await expect(exprInput(page, 1)).toHaveValue('y = a x');
    await expect(page.getByTestId('expr-input')).toHaveCount(3);
    await expect(page.getByRole('textbox', { name: 'a slider maximum' })).toHaveValue('20');
    await expect(page.getByRole('button', { name: 'Play a' })).toBeVisible();
    const value = await exprInput(page, 0).inputValue();
    await page.waitForTimeout(300);
    await expect(exprInput(page, 0)).toHaveValue(value);
    const a = Number(value.split('=')[1]);
    await expect.poll(() => countColorNear(page, 0.25, 0.25 * a, PURPLE)).toBeGreaterThan(5);
    // New rows after a restore get fresh ids: Enter still adds and focuses one.
    await setExpr(page, 2, 'y = 1');
    await exprInput(page, 2).press('Enter');
    await expect(exprInput(page, 3)).toBeFocused();
  });

  test('edits while a slider plays are saved each time the page is hidden', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    await setExpr(page, 1, 'y = a x');
    await page.getByRole('button', { name: 'Play a' }).click();
    await expect.poll(() => exprInput(page, 0).inputValue()).not.toBe('a = 1');
    await hide(page);
    expect(await stored(page)).toContain('"y = a x"');
    // Back to the app, another edit, away again.
    await setExpr(page, 1, 'y = a x^2');
    await hide(page);
    expect(await stored(page)).toContain('"y = a x^2"');
    await page.getByRole('button', { name: 'Pause a' }).click();
  });

  test('a second tab picks up what the first saves instead of writing over it', async ({
    page,
    context,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await expect.poll(() => stored(page)).toContain('"y = x"');
    const other = await context.newPage();
    await openApp(other);
    await expect(exprInput(other, 0)).toHaveValue('y = x');

    await setExpr(page, 0, 'y = x^2 + 1');
    await expect.poll(() => stored(page)).toContain('"y = x^2 + 1"');
    await expect(exprInput(other, 0)).toHaveValue('y = x^2 + 1');
    // A change in the other tab (only its view) saves the rows it now shows, not the old ones.
    await other.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => stored(page)).not.toContain('"view":null');
    expect(await stored(page)).toContain('"y = x^2 + 1"');
    await other.close();
  });

  test('the view, keypad mode and sidebar survive a reload', async ({ page }) => {
    await openApp(page);
    const home = await scale(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => scale(page)).toBeCloseTo(home * 2, 3);
    await page.getByTestId('keypad-toggle').click();
    await page.getByRole('button', { name: 'Hide expression list' }).click();
    await expect.poll(() => stored(page)).toContain('"sidebarOpen":false');
    await page.reload();
    await expect(page.getByTestId('graph')).toHaveAttribute('data-view', /,/);
    expect(await scale(page)).toBeCloseTo(home * 2, 3);
    await page.getByRole('button', { name: 'Show expression list' }).click();
    await exprInput(page, 0).click();
    await expect(exprInput(page, 0)).toHaveAttribute('inputmode', 'none');
    await expect(page.getByTestId('keypad')).toBeVisible();

    // Back at home, the view isn't pinned: it follows the window size again.
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect.poll(() => stored(page)).toContain('"view":null');
  });
});
