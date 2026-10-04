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
    const reaches = (text: string) =>
      page.waitForFunction(
        (t) =>
          (document.querySelector('[data-testid="expr-input"]') as HTMLInputElement).value === t,
        text,
        { polling: 'raf' },
      );
    await reaches('a = 9.8');
    await reaches('a = 9.5');
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

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('expr-input')).toHaveCount(3);
    await expect(exprInput(page, 0)).toHaveValue('y = x');
    await expect(exprInput(page, 1)).toHaveValue('a = 2');
    // Focus stays in the list, and the toast has nothing left to undo.
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
    await page.getByRole('button', { name: 'Undo' }).tap();
    await expect(page.getByTestId('expr-input')).toHaveCount(2);
    await expect(exprInput(page, 0)).toHaveValue('y=x');
    await expect(page.getByTestId('toast')).toHaveCount(0);
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
