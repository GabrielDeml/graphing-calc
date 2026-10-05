import { countColorNear, expect, exprInput, openApp, RED, setExpr, test } from './helpers';

test.describe('undo and redo', () => {
  test.skip(({ isMobile }) => isMobile, 'hardware keyboard and mouse');

  test('Mod+Z brings back a deleted row, Mod+Shift+Z deletes it again', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 2');
    await page.getByRole('button', { name: 'Delete expression 1' }).click();
    await expect(exprInput(page, 0)).toHaveValue('y = 2');
    await expect(page.getByTestId('expr-input')).toHaveCount(2);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('expr-input')).toHaveCount(3);
    await expect(exprInput(page, 0)).toHaveValue('y = x');
    await expect(exprInput(page, 1)).toHaveValue('y = 2');
    // With its color, and selected: no row had focus, so undo shows which one came back.
    await expect.poll(() => countColorNear(page, 1, 1, RED)).toBeGreaterThan(5);
    await expect(page.locator('.expr-row').first()).toHaveClass(/\bselected\b/);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.getByTestId('expr-input')).toHaveCount(2);
    await expect(exprInput(page, 0)).toHaveValue('y = 2');
  });

  test('typing undoes in bursts, with the caret back where the typing was', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y = x', { delay: 20 });
    // A pause ends the burst.
    await page.waitForTimeout(1200);
    await input.press('Home');
    for (let i = 0; i < 4; i++) await input.press('ArrowRight');
    await input.pressSequentially('2', { delay: 20 });
    await expect(input).toHaveValue('y = 2x');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('y = x');
    await expect(input).toBeFocused();
    expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(4);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('');
    // The row the first keystroke added below went away with it.
    await expect(page.getByTestId('expr-input')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('');

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(input).toHaveValue('y = x');
    await page.keyboard.press('Control+y');
    await expect(input).toHaveValue('y = 2x');
    expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(5);

    // Other shortcuts stay the browser's own.
    await input.press('ControlOrMeta+a');
    await page.keyboard.type('y = 3');
    await expect(input).toHaveValue('y = 3');
  });

  test('text deleted or typed over right after typing it comes back', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y = x^2', { delay: 20 });
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    await expect(input).toHaveValue('');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('y = x^2');

    await input.press('ControlOrMeta+a');
    await input.pressSequentially('x = 1', { delay: 20 });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('y = x^2');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('');
  });

  test('Backspace in the empty last row only moves up, adding no step', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await exprInput(page, 1).click();
    await page.keyboard.press('Backspace');
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(page.getByTestId('expr-input')).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(exprInput(page, 0)).toHaveValue('');
  });

  test('undo shows a row it brings back while another row has the caret', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    const rows = Array.from({ length: 16 }, (_, i) => ({ source: `y = ${i + 1}` }));
    await page.addInitScript(
      (value) => localStorage.setItem('graphing-calc:v1', value),
      JSON.stringify({ version: 1, rows, view: null }),
    );
    await openApp(page);
    await page.getByRole('button', { name: 'Delete expression 16' }).click();
    await expect(page.getByTestId('expr-input')).toHaveCount(16);
    await exprInput(page, 0).click();
    await expect(exprInput(page, 15)).not.toBeInViewport();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(exprInput(page, 15)).toHaveValue('y = 16');
    await expect(exprInput(page, 15)).toBeInViewport();
    await expect(exprInput(page, 0)).toBeFocused();
  });

  test('a slider drag is one step', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    const range = page.getByTestId('slider-a');
    const box = await range.boundingBox();
    if (!box) throw new Error('no slider box');
    const drag = async (from: number, to: number) => {
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + from * box.width, y);
      await page.mouse.down();
      await page.mouse.move(box.x + to * box.width, y, { steps: 8 });
      await page.mouse.up();
    };
    const value = () => exprInput(page, 0).inputValue();

    await drag(0.55, 0.9);
    const first = await value();
    expect(first).not.toBe('a = 1');
    await drag(0.9, 0.2);
    const second = await value();
    expect(second).not.toBe(first);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(exprInput(page, 0)).toHaveValue(first);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(exprInput(page, 0)).toHaveValue('a = 1');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(exprInput(page, 0)).toHaveValue(first);
  });

  test('arrow keys on a slider undo like typing, in one step', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    const range = page.getByTestId('slider-a');
    for (let i = 0; i < 6; i++) await range.press('ArrowRight');
    await expect(exprInput(page, 0)).not.toHaveValue('a = 1');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(exprInput(page, 0)).toHaveValue('a = 1');
  });

  test('playing a slider adds no undo steps', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    await setExpr(page, 1, 'y = a');
    await page.getByRole('button', { name: 'Play a' }).click();
    await expect.poll(() => exprInput(page, 0).inputValue()).not.toBe('a = 1');
    await page.getByRole('button', { name: 'Pause a' }).click();
    const paused = await exprInput(page, 0).inputValue();
    // The newest step is still typing `y = a`, and undoing it leaves the slider where it stopped.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(exprInput(page, 1)).toHaveValue('');
    await expect(exprInput(page, 0)).toHaveValue(paused);
    await expect(page.getByRole('button', { name: 'Play a' })).toBeVisible();
  });

  test('undoing new slider bounds keeps the value inside the old ones', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    await page.getByRole('button', { name: 'Play a' }).click();
    const max = page.getByRole('textbox', { name: 'a slider maximum' });
    await max.fill('20');
    await max.press('Enter');
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="expr-input"]') as HTMLInputElement;
        return Number(el.value.split('=')[1]) > 10.5;
      },
      undefined,
      { polling: 'raf' },
    );
    await page.getByRole('button', { name: 'Pause a' }).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(max).toHaveValue('10');
    const value = Number((await exprInput(page, 0).inputValue()).split('=')[1]);
    expect(value).toBeLessThanOrEqual(10);
  });

  test('a playing slider whose step does not divide its range adds no steps', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 8');
    const step = page.getByRole('textbox', { name: 'a slider step' });
    await step.fill('0.3');
    await step.press('Enter');
    await setExpr(page, 1, 'y = a');
    await page.getByRole('button', { name: 'Play a' }).click();
    // Up to the top of the range and back: the last step below 10 is 9.8, and snapping must not
    // go past 10 (that would widen the maximum, an undo step).
    // Any value past `limit` (above it going up, below it on the way down).
    const passes = (limit: number, dir: 1 | -1) =>
      page.waitForFunction(
        ([l, d]) => {
          const el = document.querySelector('[data-testid="expr-input"]') as HTMLInputElement;
          return d * Number(el.value.split('=')[1]) > d * l;
        },
        [limit, dir] as const,
        { polling: 'raf' },
      );
    await passes(9.7, 1);
    // Back down, past the top grid point whichever frames were skipped.
    await passes(9.8, -1);
    await page.getByRole('button', { name: 'Pause a' }).click();
    await expect(page.getByRole('textbox', { name: 'a slider maximum' })).toHaveValue('10');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(exprInput(page, 1)).toHaveValue('');
  });

  test('New graph clears the list, and undo brings it back', async ({ page }) => {
    await openApp(page);
    const more = page.getByRole('button', { name: 'More options' });
    // Nothing to clear yet.
    await more.click();
    await expect(page.getByRole('menuitem', { name: 'New graph' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'a = 2');
    const graph = page.getByTestId('graph');
    const home = await graph.getAttribute('data-view');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(graph).not.toHaveAttribute('data-view', home ?? '');

    // Escape closes the menu and focus goes back to its button.
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem', { name: 'New graph' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    // So does a click elsewhere.
    await more.click();
    await page.getByTestId('graph').click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole('menu')).toHaveCount(0);

    await more.press('Enter');
    await page.getByRole('menuitem', { name: 'New graph' }).press('Enter');
    await expect(page.getByRole('menu')).toHaveCount(0);
    // Ready to type the next graph.
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(page.getByTestId('expr-input')).toHaveCount(1);
    await expect(exprInput(page, 0)).toHaveValue('');
    await expect(page.getByTestId('toast')).toContainText('Graph cleared');
    // Starting over starts at the home view.
    await expect(graph).toHaveAttribute('data-view', home ?? '');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('expr-input')).toHaveCount(3);
    await expect(exprInput(page, 0)).toHaveValue('y = x');
    await expect(exprInput(page, 1)).toHaveValue('a = 2');
    // Focus stays in the list, and the toast has nothing left to undo.
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });

  test('the Undo toast waits while it has focus, then puts the caret in the list', async ({
    page,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'New graph' }).click();
    const undo = page.getByTestId('toast').getByRole('button', { name: 'Undo', exact: true });
    await undo.focus();
    // Longer than a toast lasts on its own.
    await page.waitForTimeout(6500);
    await expect(undo).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(exprInput(page, 0)).toHaveValue('y = x');
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });
});

test.describe('New graph on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');

  test('the header menu works by touch without moving the panel', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y=x');
    await page.getByRole('button', { name: 'More options' }).tap();
    await page.getByRole('menuitem', { name: 'New graph' }).tap();
    await expect(page.getByTestId('expr-input')).toHaveCount(1);
    await expect(exprInput(page, 0)).toHaveValue('');
    await expect(page.locator('.app')).toHaveAttribute('data-panel', 'half');

    // No undo key on a phone: the toast's Undo brings the graph back.
    await expect(page.getByTestId('toast')).toContainText('Graph cleared');
    await page.getByTestId('toast').getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(page.getByTestId('expr-input')).toHaveCount(2);
    await expect(exprInput(page, 0)).toHaveValue('y=x');
    await expect(page.getByTestId('toast')).toHaveCount(0);
    // Focus goes back where it was before the toast took it, not to the page.
    await expect(page.getByRole('button', { name: 'More options' })).toBeFocused();
  });

  test('one tap opens the menu from a collapsed panel, which stays collapsed', async ({ page }) => {
    await openApp(page);
    const title = page.locator('.panel-title');
    await title.tap(); // half → full
    await title.tap(); // full → collapsed
    await expect(page.locator('.app')).toHaveAttribute('data-panel', 'collapsed');
    await page.getByRole('button', { name: 'More options' }).tap();
    await expect(page.getByRole('menuitem', { name: 'New graph' })).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.app')).toHaveAttribute('data-panel', 'collapsed');
  });
});
