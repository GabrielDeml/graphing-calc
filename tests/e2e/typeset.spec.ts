import type { Locator, Page } from '@playwright/test';
import { expect, exprInput, openApp, setExpr, test } from './helpers';

function view(page: Page, index: number) {
  return page.locator('.expr-row').nth(index).locator('.math-view');
}

/** Type a row, then leave it for the next one, so it shows typeset. */
async function typeRow(page: Page, index: number, text: string) {
  await setExpr(page, index, text);
  await exprInput(page, index).press('Enter');
  await expect(exprInput(page, index + 1)).toBeFocused();
}

/** A point some way across an element (0 = its left edge, 1 = its right edge), at mid-height. */
async function across(locator: Locator, fraction: number) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box');
  return { x: b.x + b.width * fraction, y: b.y + b.height / 2 };
}

const caret = (page: Page, index: number) =>
  exprInput(page, index).evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);

test.describe('typeset rows', () => {
  test('a row shows its math typeset, over its unchanged text, once left', async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, 'y = 1/x');
    const frac = view(page, 0).locator('.m-frac');
    await expect(frac).toHaveCount(1);
    await expect(frac.locator('.m-numer')).toHaveText('1');
    await expect(frac.locator('.m-denom')).toHaveText('x');
    await expect(view(page, 0)).toBeVisible();
    // The input is still there, holding the text, invisible over the typeset math.
    await expect(exprInput(page, 0)).toHaveValue('y = 1/x');
    await expect(exprInput(page, 0)).toHaveCSS('opacity', '0');
    // Focused again, it shows the plain text.
    await exprInput(page, 0).focus();
    await expect(exprInput(page, 0)).toHaveCSS('opacity', '1');
    await expect(view(page, 0)).toBeHidden();
  });

  test('the empty first row shows its placeholder', async ({ page }) => {
    await openApp(page);
    await expect(view(page, 0).locator('.m-placeholder')).toHaveText('Try y = sin(x)');
    await expect(exprInput(page, 0)).toHaveAttribute('placeholder', 'Try y = sin(x)');
  });

  test('letters group the way the graph reads them', async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, 'y = asin(x) + pix');
    await expect(view(page, 0).locator('.m-fn')).toHaveText(['asin']);
    await expect(view(page, 0).locator('.m-var')).toHaveText(['y', 'x', 'π', 'x']);
    // With a slider a, asin is a·sin.
    await typeRow(page, 1, 'a = 2');
    await expect(view(page, 0).locator('.m-fn')).toHaveText(['sin']);
    await expect(view(page, 0).locator('.m-var')).toHaveText(['y', 'a', 'x', 'π', 'x']);
    await expect(exprInput(page, 0)).toHaveValue('y = asin(x) + pix');
  });

  test('an error is underlined in the typeset math once it shows', async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, 'y = (x + 1');
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('alert')).toContainText("Missing ')'");
    await expect(view(page, 0).locator('.m-mark')).toHaveText(['(']);
    await setExpr(page, 0, 'y = (x + 1)');
    await exprInput(page, 0).press('Enter');
    await expect(row.getByRole('alert')).toHaveCount(0);
    await expect(view(page, 0).locator('.m-mark')).toHaveCount(0);
  });

  test('a tall row keeps its height while it is edited', async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, 'y = (x + 1)/(x^2 + 1)');
    const row = page.locator('.expr-row').first();
    const typeset = await row.boundingBox();
    await exprInput(page, 0).focus();
    await expect(exprInput(page, 0)).toHaveCSS('opacity', '1');
    const editing = await row.boundingBox();
    expect(typeset?.height).toBeGreaterThan(55);
    expect(Math.abs((editing?.height ?? 0) - (typeset?.height ?? 0))).toBeLessThan(1);
  });

  test('a playing slider updates its typeset value in place', async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, 'a = 1.5');
    const value = view(page, 0).locator('.m-num');
    await expect(value).toHaveText('1.5');
    await value.evaluate((el) => {
      el.dataset.seen = 'yes';
    });
    await page.getByRole('button', { name: 'Play a' }).click();
    await expect(value).not.toHaveText('1.5');
    // The same element, with new text: the view patches the value instead of redrawing.
    await expect(view(page, 0).locator('[data-seen="yes"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Pause a' }).click();
  });
});

test.describe('typeset rows with a mouse', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse');

  test('a click on the typeset math puts the caret at what was clicked', async ({ page }) => {
    await openApp(page);
    // y = 1/(x - 1): the x is at offset 7, the last 1 at offset 11.
    await typeRow(page, 0, 'y = 1/(x - 1)');
    const den = view(page, 0).locator('.m-denom');
    let at = await across(den.locator('.m-var', { hasText: 'x' }), 0.2);
    await page.mouse.click(at.x, at.y);
    await expect(exprInput(page, 0)).toBeFocused();
    expect(await caret(page, 0)).toEqual([7, 7]);

    await exprInput(page, 1).focus();
    at = await across(den.locator('.m-num', { hasText: '1' }), 0.8);
    await page.mouse.click(at.x, at.y);
    await expect(exprInput(page, 0)).toBeFocused();
    expect(await caret(page, 0)).toEqual([12, 12]);

    // Between the digits of a number, in an exponent.
    await typeRow(page, 1, 'y = x^123');
    at = await across(view(page, 1).locator('.m-sup .m-num'), 0.5);
    await page.mouse.click(at.x, at.y);
    await expect(exprInput(page, 1)).toBeFocused();
    const [start] = await caret(page, 1);
    expect([7, 8]).toContain(start);

    // Past the end of the math, the end of the text.
    await exprInput(page, 2).focus();
    const box = await view(page, 1).boundingBox();
    if (!box) throw new Error('no view box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await caret(page, 1)).toEqual([9, 9]);
  });
});

test.describe('typeset rows by touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch');

  test('a tap opens the keypad with the caret where the tap was', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = 2/x');
    await page.getByTestId('keypad-hide').tap();
    await exprInput(page, 0).evaluate((el) => el.blur());
    await expect(view(page, 0).locator('.m-frac')).toHaveCount(1);
    const at = await across(view(page, 0).locator('.m-numer'), 0.1);
    await page.touchscreen.tap(at.x, at.y);
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(exprInput(page, 0)).toHaveAttribute('inputmode', 'none');
    await expect(page.getByTestId('keypad')).toBeVisible();
    expect(await caret(page, 0)).toEqual([4, 4]);
  });
});
