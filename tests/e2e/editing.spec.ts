import { contains, expect, exprInput, openApp, setExpr, test, worldToScreen } from './helpers';

test.describe('editing rows', () => {
  test.skip(({ isMobile }) => isMobile, 'hardware keyboard and mouse');

  test('a bad t range keeps its fields so it can be fixed', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, '(cos t, sin t)');
    const max = page.getByRole('textbox', { name: 't maximum' });
    await max.click();
    await max.press('ControlOrMeta+a');
    await max.pressSequentially('4p', { delay: 50 });
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('alert')).toContainText('t range');
    // Still there, still focused, and flagged.
    await expect(max).toBeFocused();
    await expect(max).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.type('i');
    await expect(max).toHaveValue('4pi');
    await expect(row.getByRole('alert')).toHaveCount(0);
    await expect(max).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('deleting a slider the t range uses leaves the range editable', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'k = 3');
    await setExpr(page, 1, '(cos t, sin t)');
    await page.getByRole('textbox', { name: 't maximum' }).fill('k');
    await page.getByRole('button', { name: 'Delete expression 1' }).click();
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('alert')).toContainText("'k' is not defined");
    await page.getByRole('textbox', { name: 't maximum' }).fill('2pi');
    await expect(row.getByRole('alert')).toHaveCount(0);
  });

  test('the slider thumb follows bound changes', async ({ page }) => {
    await openApp(page);
    const range = page.getByTestId('slider-c');
    await setExpr(page, 0, 'c = 7');
    const max = page.getByRole('textbox', { name: 'c slider maximum' });
    await max.fill('5');
    await expect(range).toHaveJSProperty('value', '5');
    await max.fill('10');
    await expect(range).toHaveJSProperty('value', '7');

    // Typed past the max: the max widens and the thumb ends up at the value, not clamped.
    await exprInput(page, 0).click();
    await exprInput(page, 0).press('End');
    await exprInput(page, 0).pressSequentially('50', { delay: 30 });
    await expect(exprInput(page, 0)).toHaveValue('c = 750');
    await expect(max).toHaveValue('750');
    await expect(range).toHaveJSProperty('value', '750');
  });

  test('widening a bound keeps the typed value exactly', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 10.123');
    await expect(page.getByRole('textbox', { name: 'a slider maximum' })).toHaveValue('10.123');
    await expect(page.getByTestId('slider-a')).toHaveJSProperty('value', '10.123');
    await setExpr(page, 0, 'a = -25');
    await expect(page.getByRole('textbox', { name: 'a slider minimum' })).toHaveValue('-25');
    await expect(page.getByTestId('slider-a')).toHaveJSProperty('value', '-25');
  });

  test('a playing slider holds still while its row is edited', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    await page.getByRole('button', { name: 'Play a' }).click();
    await expect.poll(async () => exprInput(page, 0).inputValue()).not.toBe('a = 1');
    const input = exprInput(page, 0);
    await input.click();
    await input.press('Home');
    await input.press('ArrowRight');
    await input.pressSequentially('bc', { delay: 80 });
    await expect(input).toHaveValue(/^abc = -?\d/);
    expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(3);
    // Still playing: it moves again once the row is left.
    await expect(page.getByRole('button', { name: 'Pause abc' })).toBeVisible();
    const held = await input.inputValue();
    await page.getByTestId('graph').click({ position: { x: 5, y: 5 } });
    await expect.poll(() => input.inputValue()).not.toBe(held);
  });

  test('a dragged slider shows its value over the thumb', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 0');
    const range = page.getByTestId('slider-a');
    const box = await range.boundingBox();
    if (!box) throw new Error('no slider box');
    const bubble = page.locator('.slider-bubble');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 4 });
    await expect(bubble).toBeVisible();
    const value = (await exprInput(page, 0).inputValue()).split('=')[1].trim();
    await expect(bubble).toHaveText(value);

    // At the far end it stays inside the track (and the list doesn't scroll sideways).
    await page.mouse.move(box.x + box.width + 20, box.y + box.height / 2, { steps: 4 });
    await expect(exprInput(page, 0)).toHaveValue('a = 10');
    const end = await bubble.boundingBox();
    if (!end) throw new Error('no bubble box');
    expect(end.x + end.width).toBeLessThanOrEqual(box.x + box.width + 1);
    const scroller = page.locator('.panel-scroll');
    expect(await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    // Near the start it would cover the row's own "a = -10", which shows the value right there.
    await page.mouse.move(box.x + 2, box.y + box.height / 2, { steps: 8 });
    await expect(exprInput(page, 0)).toHaveValue(/^a = -/);
    await expect(bubble).toBeHidden();

    await page.mouse.up();
    await expect(bubble).toHaveCount(0);
  });

  test('a right click on a slider shows no bubble', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 0');
    const box = await page.getByTestId('slider-a').boundingBox();
    if (!box) throw new Error('no slider box');
    // The context menu would take the button's release, leaving a bubble behind.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await expect(page.locator('.slider-bubble')).toHaveCount(0);
    await page.mouse.up({ button: 'right' });
  });

  test('moving a playing slider continues from the new value', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 0');
    await page.getByRole('button', { name: 'Play a' }).click();
    const range = page.getByTestId('slider-a');
    const box = await range.boundingBox();
    if (!box) throw new Error('no slider box');
    await range.click({ position: { x: box.width - 1, y: box.height / 2 } });
    const value = async () => Number((await exprInput(page, 0).inputValue()).split('=')[1]);
    // The animation sweeps 20 units in 5s; it must keep going from ~10, not jump back to ~0.
    await page.waitForTimeout(150);
    expect(await value()).toBeGreaterThan(8);
    await page.waitForTimeout(150);
    expect(await value()).toBeGreaterThan(7);
  });

  test('the color button opens and closes the picker, and focus returns to it', async ({
    page,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    const toggle = page.getByRole('button', { name: 'Change color', exact: true });
    await toggle.click();
    await expect(page.locator('.color-picker')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(page.locator('.color-picker')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.press('Enter');
    await expect(page.getByRole('button', { name: 'Red', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.color-picker')).toHaveCount(0);
    await expect(toggle).toBeFocused();

    await toggle.press('Enter');
    await page.getByRole('button', { name: 'Purple', exact: true }).press('Enter');
    await expect(page.locator('.color-picker')).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test('every color can be picked, over the rows below the picker', async ({ page }) => {
    await openApp(page);
    const sources = ['y = x', 'y = 2x', 'y = 3x'];
    for (const [i, text] of sources.entries()) await setExpr(page, i, text);
    await exprInput(page, 0).click();
    const toggle = page.locator('.expr-row').first().getByRole('button', { name: 'Change color' });
    await toggle.click();
    const names = await page
      .locator('.color-choice')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(names.length).toBeGreaterThan(3);
    await toggle.click();
    for (const name of names) {
      await toggle.click();
      // The click fails if anything (the next row's buttons) lies over the swatch.
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('.color-picker')).toHaveCount(0);
      await toggle.click();
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await toggle.click();
    }
    for (const [i, text] of sources.entries()) await expect(exprInput(page, i)).toHaveValue(text);
  });

  test('the color picker of a low row is scrolled into view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await openApp(page);
    for (let i = 0; i < 12; i++) await setExpr(page, i, `y = ${i}`);
    const scroller = page.locator('.panel-scroll');
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    const area = await scroller.boundingBox();
    if (!area) throw new Error('no scroller box');
    // The lowest row that is fully in view: its picker would hang below the visible list.
    let lowest = -1;
    for (let i = 0; i < 12; i++) {
      const b = await exprInput(page, i).boundingBox();
      if (b && b.y + b.height <= area.y + area.height) lowest = i;
    }
    expect(lowest).toBeGreaterThan(0);
    await page
      .locator('.expr-row')
      .nth(lowest)
      .getByRole('button', { name: 'Change color' })
      .click();
    const picker = await page.locator('.color-picker').boundingBox();
    if (!picker) throw new Error('no picker box');
    expect(picker.y + picker.height).toBeLessThanOrEqual(area.y + area.height + 1);
    expect(picker.y).toBeGreaterThanOrEqual(area.y - 1);
  });

  test('a focused row stays selected until Esc, a click on empty graph, or its deletion', async ({
    page,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    const row = page.locator('.expr-row').first();
    await expect(row).toHaveClass(/\bselected\b/);
    // Clicking the curve moves focus to the graph, but the row stays selected; Esc there clears it.
    const { sx, sy } = await worldToScreen(page, 1, 1);
    await page.getByTestId('graph').click({ position: { x: sx, y: sy } });
    await expect(exprInput(page, 0)).not.toBeFocused();
    await expect(row).toHaveClass(/\bselected\b/);
    await page.keyboard.press('Escape');
    await expect(row).not.toHaveClass(/\bselected\b/);

    await exprInput(page, 0).click();
    await page.getByTestId('graph').click({ position: { x: 5, y: 5 } });
    await expect(row).not.toHaveClass(/\bselected\b/);

    await exprInput(page, 0).click();
    await expect(row).toHaveClass(/\bselected\b/);
    await exprInput(page, 0).press('Escape');
    await expect(row).not.toHaveClass(/\bselected\b/);

    // Esc that closes the color picker only closes the picker.
    await exprInput(page, 0).click();
    await row.getByRole('button', { name: 'Change color', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.color-picker')).toHaveCount(0);
    await expect(row).toHaveClass(/\bselected\b/);

    await page.getByRole('button', { name: 'Delete expression 1' }).click();
    await expect(exprInput(page, 0)).toHaveValue('');
    await expect(page.locator('.expr-row.selected')).toHaveCount(0);
  });

  test('Enter on an empty row moves on instead of adding more rows', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await exprInput(page, 0).press('Enter');
    await expect(exprInput(page, 1)).toBeFocused();
    await exprInput(page, 1).press('Enter');
    await exprInput(page, 1).press('Enter');
    await expect(page.getByTestId('expr-input')).toHaveCount(2);
    await expect(exprInput(page, 1)).toBeFocused();

    // In the middle of the list, an empty row goes on to the next one.
    await setExpr(page, 1, 'y = 2');
    await exprInput(page, 0).press('Enter');
    await expect(exprInput(page, 1)).toBeFocused();
    await expect(exprInput(page, 1)).toHaveValue('');
    await exprInput(page, 1).press('Enter');
    await expect(exprInput(page, 2)).toBeFocused();
    await expect(exprInput(page, 2)).toHaveValue('y = 2');
    await expect(page.getByTestId('expr-input')).toHaveCount(4);
  });

  test('deleting a row from the keyboard keeps focus in the list', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 2');
    await page.getByRole('button', { name: 'Delete expression 1' }).press('Enter');
    await expect(exprInput(page, 0)).toHaveValue('y = 2');
    await expect(exprInput(page, 0)).toBeFocused();
  });

  test('Enter and Escape finish editing a slider bound', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    const max = page.getByRole('textbox', { name: 'a slider maximum' });
    await max.fill('20');
    await max.press('Enter');
    await expect(max).not.toBeFocused();
    await max.click();
    await max.press('Escape');
    await expect(max).not.toBeFocused();
  });

  test('a held Backspace stops at an emptied row instead of eating the one above', async ({
    page,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x + 1');
    await setExpr(page, 1, 'x');
    await exprInput(page, 1).press('End');
    // Repeated keydowns (auto-repeat) after the first one carry `repeat: true`.
    for (let i = 0; i < 4; i++) await page.keyboard.down('Backspace');
    await page.keyboard.up('Backspace');
    await expect(exprInput(page, 1)).toHaveValue('');
    await expect(exprInput(page, 0)).toHaveValue('y = x + 1');
    // A fresh press does delete the empty row.
    await page.keyboard.press('Backspace');
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(exprInput(page, 0)).toHaveValue('y = x + 1');
  });

  test('the error underline lines up in a scrolled row', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    const text = `y = ${'x + '.repeat(16)}(x`;
    await input.pressSequentially(text);
    const row = page.locator('.expr-row').first();
    await expect(row.getByRole('alert')).toBeVisible();
    // The math scrolled to keep the caret in view, and the mark on the open '(' scrolled with it.
    const math = row.locator('.math-view').first();
    expect(await math.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const area = await math.boundingBox();
    const mark = await math.locator('.m-mark').boundingBox();
    const caret = await math.locator('.m-caret').boundingBox();
    if (!area || !mark || !caret) throw new Error('no boxes');
    await expect(math.locator('.m-mark')).toHaveText('(');
    expect(contains(area, mark)).toBe(true);
    expect(contains(area, caret)).toBe(true);
    expect(mark.x).toBeLessThan(caret.x);
    expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(text.length);
  });
});
