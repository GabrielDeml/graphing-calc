import type { Locator, Page } from '@playwright/test';
import { contains, countColor, expect, exprInput, openApp, RED, setExpr, test } from './helpers';

/** A row's typeset math (its first: slider bounds are typeset too). */
function math(page: Page, index: number) {
  return page.locator('.expr-row').nth(index).locator('.math-view').first();
}

const caret = (input: Locator) =>
  input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);

/**
 * Whether the drawn caret stands inside an element's box. The caret glides between places, so
 * ask with expect.poll: right after a key it can still be on its way.
 */
async function caretIn(page: Page, index: number, selector: string): Promise<boolean> {
  const c = await math(page, index).locator('.m-caret').boundingBox();
  const area = await math(page, index).locator(selector).first().boundingBox();
  if (!c || !area) return false;
  const x = c.x + c.width / 2;
  const y = c.y + c.height / 2;
  return (
    x >= area.x - 1 && x <= area.x + area.width + 1 && y >= area.y && y <= area.y + area.height
  );
}

test.describe('editing a row in place', () => {
  test.skip(({ isMobile }) => isMobile, 'hardware keyboard and mouse');

  test('a fraction typed key by key keeps what follows in its denominator', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y=1/2x', { delay: 30 });
    await expect(input).toHaveValue('y=1/(2x)');
    const frac = math(page, 0).locator('.m-frac');
    await expect(frac).toHaveCount(1);
    await expect(frac.locator('.m-numer')).toHaveText('1');
    await expect(frac.locator('.m-denom')).toHaveText('2x');
    // Still in the denominator, before its closing parenthesis.
    expect(await caret(input)).toEqual([7, 7]);
    await expect.poll(() => caretIn(page, 0, '.m-denom')).toBe(true);
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(100);
  });

  test('+ leaves an exponent, and so does Space', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y=x^2+1', { delay: 30 });
    await expect(input).toHaveValue('y=x^2+1');
    await expect(math(page, 0).locator('.m-sup')).toHaveText('2');
    await setExpr(page, 1, '');
    await exprInput(page, 1).pressSequentially('y=e^2 x', { delay: 30 });
    await expect(exprInput(page, 1)).toHaveValue('y=e^2x');
    await expect(math(page, 1).locator('.m-sup')).toHaveText('2');
    // Typed on in the exponent instead, letters stay in it.
    await setExpr(page, 2, '');
    await exprInput(page, 2).pressSequentially('y=e^2x', { delay: 30 });
    await expect(exprInput(page, 2)).toHaveValue('y=e^(2x)');
    await expect(math(page, 2).locator('.m-sup')).toHaveText('2x');
  });

  test('Up and Down move between numerator and denominator, else between rows', async ({
    page,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    const input = exprInput(page, 1);
    await input.click();
    await input.pressSequentially('12/34', { delay: 30 });
    expect(await caret(input)).toEqual([5, 5]);
    await input.press('ArrowUp');
    expect(await caret(input)).toEqual([2, 2]);
    await expect.poll(() => caretIn(page, 1, '.m-numer')).toBe(true);
    await input.press('ArrowDown');
    expect(await caret(input)).toEqual([5, 5]);
    await expect.poll(() => caretIn(page, 1, '.m-denom')).toBe(true);
    // Into the numerator, then up again: there is nothing above in the row, so the row above.
    await input.press('ArrowUp');
    await input.press('ArrowUp');
    await expect(exprInput(page, 0)).toBeFocused();
  });

  test('arrows walk through the structure, and → closes an open group', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y=(x+1', { delay: 30 });
    // An open group draws the closer it still needs, faintly.
    await expect(math(page, 0).locator('.m-ghost')).toHaveText(')');
    await input.press('ArrowRight');
    await expect(input).toHaveValue('y=(x+1)');
    await expect(math(page, 0).locator('.m-ghost')).toHaveCount(0);
    await input.press('Home');
    for (let i = 0; i < 3; i++) await input.press('ArrowRight');
    expect(await caret(input)).toEqual([3, 3]);
    await input.press('End');
    expect(await caret(input)).toEqual([7, 7]);
  });

  test('Backspace takes structures apart', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('sqrt', { delay: 30 });
    // Typing sqrt opens its parentheses, the caret inside.
    await expect(input).toHaveValue('sqrt()');
    expect(await caret(input)).toEqual([5, 5]);
    await expect(math(page, 0).locator('.m-sqrt')).toHaveCount(1);
    await input.press('x');
    await expect(input).toHaveValue('sqrt(x)');
    await input.press('Backspace');
    await input.press('Backspace');
    await expect(input).toHaveValue('');
    await input.pressSequentially('1/2', { delay: 30 });
    await input.press('Backspace');
    await input.press('Backspace');
    await expect(input).toHaveValue('1');
  });

  test('a selection made with Shift, or by dragging, is wrapped by /', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('x+1', { delay: 30 });
    await input.press('Shift+Home');
    expect(await caret(input)).toEqual([0, 3]);
    await expect(math(page, 0).locator('.m-selection')).toBeVisible();
    await input.press('/');
    await expect(input).toHaveValue('(x+1)/');
    await input.press('2');
    await expect(input).toHaveValue('(x+1)/2');

    // A drag across the math selects it.
    await setExpr(page, 1, 'y = 3x + 4');
    const box = await math(page, 1).locator('.m-root').boundingBox();
    if (!box) throw new Error('no math box');
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(exprInput(page, 1)).toBeFocused();
    const [start, end] = await caret(exprInput(page, 1));
    expect(end).toBe(10);
    expect(start).toBeGreaterThan(2);
    expect(start).toBeLessThan(8);
    await expect(math(page, 1).locator('.m-selection')).toBeVisible();
  });

  test('the caret keeps its place when the field loses focus and gets it back', async ({
    page,
  }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y=1/2', { delay: 30 });
    await input.evaluate((el: HTMLInputElement) => {
      el.blur();
      el.focus();
    });
    await input.press('x');
    await expect(input).toHaveValue('y=1/(2x)');
    await expect.poll(() => caretIn(page, 0, '.m-denom')).toBe(true);
  });

  test('after End, what is typed goes into an empty denominator', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await setExpr(page, 0, 'y=1/');
    await input.press('Home');
    await input.press('End');
    await input.press('2');
    await expect(input).toHaveValue('y=1/2');
  });

  test('a click on a long row puts the caret there without scrolling the math', async ({
    page,
  }) => {
    await openApp(page);
    const long = `y = ${Array.from({ length: 30 }, () => 'x').join(' + ')} + 1`;
    await setExpr(page, 0, long);
    await exprInput(page, 1).click();
    const view = math(page, 0);
    const third = view.locator('.m-var').nth(3);
    const box = await third.boundingBox();
    if (!box) throw new Error('no box');
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    await expect(exprInput(page, 0)).toBeFocused();
    expect(await caret(exprInput(page, 0))).toEqual([13, 13]);
    expect(await view.evaluate((el) => el.scrollLeft)).toBe(0);
    // A wheel or a trackpad slides it sideways; the caret stays where it is in the text.
    await page.mouse.wheel(400, 0);
    await expect.poll(() => view.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    expect(await caret(exprInput(page, 0))).toEqual([13, 13]);
  });

  test('a double click selects the number or name under it', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = 23x + 4');
    const box = await math(page, 0).locator('.m-num', { hasText: '23' }).boundingBox();
    if (!box) throw new Error('no box');
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    expect(await caret(exprInput(page, 0))).toEqual([4, 6]);
    await expect(math(page, 0).locator('.m-selection')).toBeVisible();
  });

  test('↑ and ↓ to the next row keep the caret where it is on screen', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = 22222x + 3');
    await setExpr(page, 1, 'y = x');
    const input = exprInput(page, 1);
    await input.press('End');
    // Read once the caret has stopped gliding.
    await page.waitForTimeout(200);
    const from = await math(page, 1).locator('.m-caret').boundingBox();
    await input.press('ArrowUp');
    await expect(exprInput(page, 0)).toBeFocused();
    await page.waitForTimeout(200);
    // Over the end of `y = x`, among the 2s, not at offset 5 of the row above.
    const to = await math(page, 0).locator('.m-caret').boundingBox();
    if (!from || !to) throw new Error('no caret');
    expect(Math.abs(to.x - from.x)).toBeLessThan(12);
  });

  test('pasted text is kept as it is', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = sin(x)/2');
    await exprInput(page, 0).press('ControlOrMeta+a');
    await exprInput(page, 0).press('ControlOrMeta+c');
    await exprInput(page, 1).click();
    await exprInput(page, 1).press('ControlOrMeta+v');
    await expect(exprInput(page, 1)).toHaveValue('y = sin(x)/2');
    await expect(math(page, 1).locator('.m-numer')).toHaveText('sin(x)');
  });

  test('text composed with an IME is written once, as composed', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y=', { delay: 30 });
    // A pause ends the typing's undo step.
    await page.waitForTimeout(1100);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '1', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: '1/', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.imeSetComposition', { text: '1/2', selectionStart: 3, selectionEnd: 3 });
    // Shown while composed, though nothing is written yet.
    await expect(math(page, 0).locator('.m-frac')).toHaveCount(1);
    await cdp.send('Input.insertText', { text: '1/2' });
    // As composed: the typing rules are for keystrokes.
    await expect(input).toHaveValue('y=1/2');
    // Written once: one undo step takes all of it, and nothing in between ('y=1', 'y=1/').
    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('y=');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(input).toHaveValue('y=1/2');
    await input.press('End');
    await input.press('x');
    await expect(input).toHaveValue('y=1/2x');
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(100);
  });

  test('a letter a phone keyboard composes goes through the typing rules', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y=1/2', { delay: 30 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'x', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.insertText', { text: 'x' });
    await expect(input).toHaveValue('y=1/(2x)');
    await expect.poll(() => caretIn(page, 0, '.m-denom')).toBe(true);
  });

  test('undo after structural typing brings back the text and the caret', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y=1/2', { delay: 30 });
    // A pause ends the burst.
    await page.waitForTimeout(1200);
    await input.press('x');
    await expect(input).toHaveValue('y=1/(2x)');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('y=1/2');
    expect(await caret(input)).toEqual([5, 5]);
    // In the denominator, where the caret was, not after the fraction.
    await expect.poll(() => caretIn(page, 0, '.m-denom')).toBe(true);
    await input.press('x');
    await expect(input).toHaveValue('y=1/(2x)');
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(input).toHaveValue('y=1/(2x)');
  });
});

test.describe('editing a row in place with the keypad', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');

  test('÷ starts a fraction and → leaves it', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    for (const id of ['y', 'eq', 'x', 'div', '2'])
      await page.getByTestId(`key-${id}`).first().tap();
    await expect(exprInput(page, 0)).toHaveValue('y=x/2');
    await expect(math(page, 0).locator('.m-denom')).toHaveText('2');
    for (const id of ['right', 'add', '1']) await page.getByTestId(`key-${id}`).first().tap();
    await expect(exprInput(page, 0)).toHaveValue('y=x/2+1');
    await expect(exprInput(page, 0)).toBeFocused();
  });

  test('a² squares and goes on after the exponent', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    for (const id of ['y', 'eq', 'x', 'sq', 'add', '1']) {
      await page.getByTestId(`key-${id}`).first().tap();
    }
    await expect(exprInput(page, 0)).toHaveValue('y=x^2+1');
    await expect(math(page, 0).locator('.m-sup')).toHaveText('2');
  });

  test('|a| puts what follows between its bars', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    for (const id of ['y', 'eq', 'abs', 'x']) await page.getByTestId(`key-${id}`).first().tap();
    await expect(exprInput(page, 0)).toHaveValue('y=|x|');
    await expect(page.locator('.expr-row').first().getByRole('alert')).toHaveCount(0);
  });

  test('the caret is drawn in the row, and a tap moves it', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    for (const id of ['y', 'eq', 'x', 'div', '2'])
      await page.getByTestId(`key-${id}`).first().tap();
    const view = math(page, 0);
    await expect(view.locator('.m-caret')).toBeVisible();
    const area = await view.boundingBox();
    const drawn = await view.locator('.m-caret').boundingBox();
    const y = await view.locator('.m-var', { hasText: 'y' }).boundingBox();
    if (!area || !drawn || !y) throw new Error('no boxes');
    expect(contains(area, drawn)).toBe(true);
    await page.touchscreen.tap(y.x + y.width * 0.8, y.y + y.height / 2);
    expect(await caret(exprInput(page, 0))).toEqual([1, 1]);
    await expect(exprInput(page, 0)).toHaveAttribute('inputmode', 'none');
  });
});
