import type { Page } from '@playwright/test';
import {
  BLUE,
  countColor,
  expect,
  exprInput,
  openApp,
  setExpr,
  test,
  worldToScreen,
} from './helpers';

const traceStatus = (page: Page) => page.getByTestId('trace').getByRole('status');
const caretOf = (page: Page, i: number) =>
  exprInput(page, i).evaluate((el: HTMLInputElement) => el.selectionStart);

test.describe('one-keystroke fixes', () => {
  test.skip(({ isMobile }) => isMobile, 'hardware keyboard');

  test('Tab takes the fix the error offers, and the caret stays', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y = x2', { delay: 30 });
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('alert')).toContainText('Missing operator before 2');
    await expect(row.getByRole('button', { name: 'Write x^2' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Write 2x' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(input).toHaveValue('y = x^2');
    await expect(input).toBeFocused();
    expect(await caretOf(page, 0)).toBe(7);
    await expect(row.getByRole('alert')).toHaveCount(0);
    // One undo step.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('y = x2');

    // (Typed key by key, `=<` would become `<=` at once.)
    await setExpr(page, 0, 'y =< x + 1');
    await expect(row.getByRole('button', { name: 'Write <=' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(input).toHaveValue('y <= x + 1');
    expect(await caretOf(page, 0)).toBe(10);
  });

  test('a fix can be clicked, the other one too', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = (x+1)2');
    const row = page.locator('.expr-row').first();
    await row.getByRole('button', { name: 'Write 2(x+1)' }).click();
    await expect(exprInput(page, 0)).toHaveValue('y = 2(x+1)');
    await setExpr(page, 1, 'y = sin^-1(x)');
    await page.locator('.expr-row').nth(1).getByRole('button', { name: 'Write asin' }).click();
    await expect(exprInput(page, 1)).toHaveValue('y = asin(x)');
    await setExpr(page, 2, 'a = x^2');
    // Left first: the fix is there after the row too.
    await page.getByTestId('graph').click({ position: { x: 5, y: 5 } });
    await page.locator('.expr-row').nth(2).getByRole('button', { name: 'Write a(x) = …' }).click();
    await expect(exprInput(page, 2)).toHaveValue('a(x) = x^2');
  });

  test('Tab moves on as usual when nothing is offered', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y = x', { delay: 30 });
    await page.keyboard.press('Tab');
    await expect(input).not.toBeFocused();
    await expect(input).toHaveValue('y = x');
    // A row with an error, only passed through: Tab moves on too.
    await setExpr(page, 1, 'y = x2');
    await expect(page.locator('.expr-row').nth(1).getByRole('alert')).toBeVisible();
    await exprInput(page, 0).click();
    await exprInput(page, 0).press('ArrowDown');
    await expect(exprInput(page, 1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(exprInput(page, 1)).not.toBeFocused();
    await expect(exprInput(page, 1)).toHaveValue('y = x2');
  });
});

test.describe('ghost completions', () => {
  test.skip(({ isMobile }) => isMobile, 'hardware keyboard');

  test('the rest of a function name shows after the caret; Tab or → takes it', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y = si', { delay: 30 });
    const ghost = page.locator('.expr-row').first().locator('.m-completion');
    await expect(ghost).toHaveText('n(');
    await page.keyboard.press('Tab');
    await expect(input).toHaveValue('y = sin(');
    await expect(input).toBeFocused();
    await expect(ghost).toHaveCount(0);
    await page.keyboard.type('x) + 2sq');
    await expect(ghost).toHaveText('rt(');
    await page.keyboard.press('ArrowRight');
    await expect(input).toHaveValue('y = sin(x) + 2sqrt()');
    await page.keyboard.type('x');
    await expect(input).toHaveValue('y = sin(x) + 2sqrt(x)');
    // One letter offers nothing, so → leaves the radical as usual.
    await page.keyboard.press('ArrowRight');
    // The ghost goes as soon as the letters stop fitting, and is never typed by itself.
    await page.keyboard.type(' + ab');
    await expect(ghost).toHaveText('s(');
    await page.keyboard.type('c');
    await expect(ghost).toHaveCount(0);
    await expect(input).toHaveValue('y = sin(x) + 2sqrt(x) + abc');
  });

  test("the document's own functions complete too; known letters do not", async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'area(r) = pi r^2');
    const input = exprInput(page, 1);
    await input.click();
    await input.pressSequentially('y = ar', { delay: 30 });
    const ghost = page.locator('.expr-row').nth(1).locator('.m-completion');
    await expect(ghost).toHaveText('ea(');
    await page.keyboard.press('Tab');
    await page.keyboard.type('x');
    await expect(input).toHaveValue('y = area(x');
    // `ex` is e·x: nothing to complete, and → and Tab do what they always do.
    await setExpr(page, 2, 'y = ex');
    await expect(page.locator('.m-completion')).toHaveCount(0);
    await exprInput(page, 2).press('ArrowRight');
    await expect(exprInput(page, 2)).toHaveValue('y = ex');
  });
});

test.describe('ghost completions on the keypad', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');

  test('the → key takes it', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await input.pressSequentially('y = co', { delay: 30 });
    await expect(page.locator('.m-completion')).toHaveText('s(');
    await page.getByTestId('key-right').first().tap();
    await expect(input).toHaveValue('y = cos(');
    await expect(input).toBeFocused();
  });
});

test.describe('trace actions', () => {
  test('a pinned point of a curve: Tangent here and Keep point add rows', async ({
    page,
    isMobile,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    const graph = page.getByTestId('graph');
    if (isMobile) {
      // Put the keypad away first (a tap on empty graph), then tap the root.
      await graph.tap({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('keypad')).toHaveCount(0);
      const root = await worldToScreen(page, Math.SQRT2, 0);
      await graph.tap({ position: { x: root.sx, y: root.sy } });
    } else {
      await page.getByRole('button', { name: /^Root \(1\.41/ }).click();
    }
    await expect(traceStatus(page)).toHaveText(/^\(1\.41\d*, 0\)$/);
    const point = (await traceStatus(page).textContent()) ?? '';
    await page.getByRole('button', { name: 'Tangent here' }).click();
    await expect(exprInput(page, 1)).toHaveValue(/^y = 2\.8\d*\(x - 1\.41\d*\)$/);
    // The tangent draws (the second curve: blue), and the trace stays pinned where it was.
    await expect.poll(() => countColor(page, BLUE)).toBeGreaterThan(100);
    await expect(traceStatus(page)).toHaveText(point);
    await page.getByRole('button', { name: 'Keep point' }).click();
    await expect(exprInput(page, 1)).toHaveValue(point);
    await expect(exprInput(page, 2)).toHaveValue(/^y = 2\.8/);
  });

  test('a hovering trace has no actions', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse');
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    const { sx, sy } = await worldToScreen(page, 2, 2);
    const box = await page.getByTestId('graph').boundingBox();
    if (!box) throw new Error('no graph box');
    await page.mouse.move(box.x + sx, box.y + sy);
    await expect(traceStatus(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep point' })).toHaveCount(0);
  });
});
