import {
  countColor,
  expect,
  exprInput,
  openApp,
  RED,
  setExpr,
  test,
  touchSession,
} from './helpers';

const example = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('button', { name: `Graph ${name}`, exact: true });

test.describe('first run at a desk', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse and keyboard');

  test('the first row is ready to type in, with examples under it', async ({ page }) => {
    await openApp(page);
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(exprInput(page, 0)).toHaveAttribute('placeholder', 'Try y = sin(x)');
    for (const name of ['y = x²', 'x² + y² = 9', 'r = 1 + cos θ']) {
      await expect(example(page, name)).toBeVisible();
    }
    // Examples are not rows.
    await expect(page.getByTestId('expr-input')).toHaveCount(1);
    await page.keyboard.type('y = 2x');
    await expect(exprInput(page, 0)).toHaveValue('y = 2x');
    await expect(page.locator('.example-chip')).toHaveCount(0);
    // Emptied to retype it: they stay away.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(exprInput(page, 0)).toHaveValue('');
    await page.waitForTimeout(100);
    await expect(page.locator('.example-chip')).toHaveCount(0);
  });

  test('a click on an example with no row being edited puts the caret in it', async ({ page }) => {
    await openApp(page);
    // A click on the graph takes the caret out of the row.
    const g = await page.getByTestId('graph').boundingBox();
    if (!g) throw new Error('no graph');
    await page.mouse.click(g.x + g.width * 0.3, g.y + g.height * 0.7);
    await expect(exprInput(page, 0)).not.toBeFocused();
    await example(page, 'y = x²').click();
    await expect(exprInput(page, 0)).toHaveValue('y = x^2');
    await expect(exprInput(page, 0)).toBeFocused();
  });

  test('an example goes into an emptied row as into a new one: shown', async ({ page }) => {
    // The first row was hidden, then emptied.
    await page.addInitScript(() =>
      localStorage.setItem(
        'graphing-calc:v1',
        JSON.stringify({ version: 1, rows: [{ source: '', hidden: true }], view: null }),
      ),
    );
    await openApp(page);
    await example(page, 'y = x²').click();
    await expect(exprInput(page, 0)).toHaveValue('y = x^2');
    await expect(page.getByRole('button', { name: 'Hide curve' })).toBeVisible();
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
  });

  test('a click on an example graphs it, as one step that undo takes back', async ({ page }) => {
    await openApp(page);
    await example(page, 'x² + y² = 9').click();
    await expect(exprInput(page, 0)).toHaveValue('x^2 + y^2 = 9');
    await expect(page.getByTestId('expr-input')).toHaveCount(2);
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
    await expect(page.locator('.example-chip')).toHaveCount(0);
    // Its row keeps the caret, after the example, and shows what it is.
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(page.locator('.expr-row').first()).toHaveClass(/\bselected\b/);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(exprInput(page, 0)).toHaveValue('');
    await expect(page.getByTestId('expr-input')).toHaveCount(1);
    await expect(example(page, 'y = x²')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(exprInput(page, 0)).toHaveValue('x^2 + y^2 = 9');
  });

  test('a saved graph opens as it was left, without examples or a caret', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'graphing-calc:v1',
        JSON.stringify({ version: 1, rows: [{ source: 'y = x' }], view: null }),
      ),
    );
    await openApp(page);
    await expect(exprInput(page, 0)).toHaveValue('y = x');
    await expect(exprInput(page, 0)).not.toBeFocused();
    await expect(page.locator('.example-chip')).toHaveCount(0);
  });

  test('a new graph brings the examples back', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await expect(page.locator('.example-chip')).toHaveCount(0);
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'New graph' }).click();
    await expect(example(page, 'r = 1 + cos θ')).toBeVisible();
  });
});

test.describe('first run on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch');

  test('nothing pops up; a tap on an example graphs it, keypad still away', async ({ page }) => {
    await openApp(page);
    await expect(example(page, 'r = 1 + cos θ')).toBeVisible();
    await expect(exprInput(page, 0)).not.toBeFocused();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await example(page, 'r = 1 + cos θ').tap();
    await expect(exprInput(page, 0)).toHaveValue('r = 1 + cos θ');
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
    await expect(page.locator('.example-chip')).toHaveCount(0);
    await expect(exprInput(page, 0)).not.toBeFocused();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
  });

  test('a long press on an example graphs it without popping up the keypad', async ({ page }) => {
    await openApp(page);
    const chip = await example(page, 'y = x²').boundingBox();
    if (!chip) throw new Error('no chip');
    const touch = await touchSession(page);
    await touch.start({ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 });
    await page.waitForTimeout(700);
    await touch.end();
    await expect(exprInput(page, 0)).toHaveValue('y = x^2');
    await page.waitForTimeout(300);
    await expect(exprInput(page, 0)).not.toBeFocused();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
  });

  test('with the keypad open, an example goes into the row being edited', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await example(page, 'y = x²').tap();
    await expect(exprInput(page, 0)).toHaveValue('y = x^2');
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(page.getByTestId('keypad')).toBeVisible();
  });
});
