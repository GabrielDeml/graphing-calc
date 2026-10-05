import type { Page } from '@playwright/test';
import { expect, exprInput, openApp, setExpr, test } from './helpers';

/** The rows' texts, in order. */
function sources(page: Page) {
  return page
    .getByTestId('expr-input')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
}

/** Records the ids of rows that pulse from now on (the pulse itself only lasts a moment). */
async function watchPulses(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { pulsed: string[] }).pulsed = seen;
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement;
        if (el.classList.contains('pulse')) seen.push(el.dataset.rowId ?? '');
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  });
}

const pulsed = (page: Page) =>
  page.evaluate(() => (window as unknown as { pulsed: string[] }).pulsed.length);

test.describe('unknown names become sliders', () => {
  test('when typing pauses, and the row keeps its caret', async ({ page }) => {
    await openApp(page);
    await watchPulses(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y = k x + 1', { delay: 30 });
    // Offered quietly at first: a chip, no alert.
    await expect(page.getByRole('button', { name: 'Add slider: k' })).toBeVisible();
    await expect(page.locator('.expr-row').first().getByRole('alert')).toHaveCount(0);
    await expect(exprInput(page, 1)).toHaveValue('k = 1');
    await expect(page.getByTestId('toast')).toContainText('Added slider k');
    expect(await pulsed(page)).toBeGreaterThan(0);
    await expect(input).toBeFocused();
    expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(11);
    await page.keyboard.type(' + 2');
    await expect(input).toHaveValue('y = k x + 1 + 2');
    // Typing on puts the toast away: its Undo would undo the typing too.
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });

  test('not while the caret is on a name, nor for a builtin on its way', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    // The caret is on `q`: more letters may come.
    await input.pressSequentially('y = k x + q', { delay: 30 });
    await page.waitForTimeout(2000);
    expect(await sources(page)).toEqual(['y = k x + q', '']);
    // Off the name now, but `s` may be on its way to `sin`.
    await page.keyboard.type(' + s ');
    await page.waitForTimeout(2000);
    expect(await sources(page)).toEqual(['y = k x + q + s ', '']);
    await expect(page.getByRole('button', { name: 'Add sliders: k, q, s' })).toBeVisible();
    // Leaving the row makes them, all at once.
    await page.getByTestId('graph').click({ position: { x: 5, y: 5 } });
    await expect
      .poll(() => sources(page))
      .toEqual(['y = k x + q + s ', 'k = 1', 'q = 1', 's = 1', '']);
    await expect(page.getByTestId('toast')).toContainText('Added sliders k, q, s');
  });

  test('a name called like a function is left to be defined', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = f(x) + c');
    await exprInput(page, 0).press('Enter');
    await expect.poll(() => sources(page)).toEqual(['y = f(x) + c', 'c = 1', '']);
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('alert')).toContainText("'f' is not defined");
    await expect(row.getByRole('button', { name: 'Add slider: f' })).toBeVisible();
  });

  test('one undo takes them all back, and they are not made again', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = a x^2 + c');
    await exprInput(page, 0).press('Enter');
    await expect.poll(() => sources(page)).toEqual(['y = a x^2 + c', 'a = 1', 'c = 1', '']);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => sources(page)).toEqual(['y = a x^2 + c', '']);
    await expect(exprInput(page, 0)).toBeFocused();
    // Undone, so not made again when the row is left: it says what is missing instead.
    await exprInput(page, 1).click();
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('alert')).toContainText("'a' is not defined");
    expect(await sources(page)).toEqual(['y = a x^2 + c', '']);
    // Redo makes them again.
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => sources(page)).toEqual(['y = a x^2 + c', 'a = 1', 'c = 1', '']);
  });

  test('never from a range field', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, '(cos t, sin t)');
    const max = page.getByRole('textbox', { name: 't maximum' });
    await max.fill('k');
    await max.press('Enter');
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('alert')).toContainText("'k' is not defined");
    expect(await sources(page)).toEqual(['(cos t, sin t)', '']);
  });

  test('a slider made this way takes a round range for a typed value', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = a x');
    await exprInput(page, 0).press('Enter');
    await expect(exprInput(page, 1)).toHaveValue('a = 1');
    const min = page.getByRole('textbox', { name: 'a slider minimum' });
    const max = page.getByRole('textbox', { name: 'a slider maximum' });
    await expect(min).toHaveValue('-10');
    await expect(max).toHaveValue('10');
    // Inside the range: it stays.
    await setExpr(page, 1, 'a = 3');
    await expect(max).toHaveValue('10');
    await setExpr(page, 1, 'a = 50');
    await expect(min).toHaveValue('0');
    await expect(max).toHaveValue('100');
    await expect(page.getByTestId('slider-a')).toHaveJSProperty('value', '50');
    await setExpr(page, 1, 'a = -3');
    await expect(min).toHaveValue('-10');
    await expect(max).toHaveValue('0');
    // Bounds the user set are theirs: a value past them widens them as usual.
    await max.fill('5');
    await setExpr(page, 1, 'a = 8');
    await expect(min).toHaveValue('-10');
    await expect(max).toHaveValue('8');
  });
});
