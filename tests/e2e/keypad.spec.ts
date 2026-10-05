import type { Locator, Page } from '@playwright/test';
import {
  center,
  contains,
  countColor,
  expect,
  exprInput,
  openApp,
  pinchOut,
  RED,
  setExpr,
  test,
  touchSession,
} from './helpers';

async function tapKeys(page: Page, ids: readonly string[]) {
  for (const id of ids) await page.getByTestId(`key-${id}`).first().tap();
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box');
  return b;
}

test.describe('math keypad on touch devices', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');

  test('panel sits below the graph and snaps', async ({ page }) => {
    await openApp(page);
    const graph = await page.getByTestId('graph').boundingBox();
    const panel = await page.locator('.panel').boundingBox();
    expect(graph && panel && panel.y >= graph.y + graph.height - 1).toBe(true);
    await page.locator('.panel-title').tap();
    await expect(page.locator('.app')).toHaveAttribute('data-panel', 'full');
    await page.locator('.panel-title').tap();
    await expect(page.locator('.app')).toHaveAttribute('data-panel', 'collapsed');
  });

  test('tapping a row opens our keypad instead of the device keyboard', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await expect(exprInput(page, 0)).toHaveAttribute('inputmode', 'none');
    await expect(exprInput(page, 0)).toBeFocused();
  });

  test('typing with keys draws a curve and keeps focus', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    for (const id of ['y', 'eq', 'x', 'pow', '2']) {
      await page
        .getByTestId(new RegExp(`^key-${id}$`))
        .first()
        .tap();
      await expect(exprInput(page, 0)).toBeFocused();
    }
    await expect(exprInput(page, 0)).toHaveValue('y=x^2');
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
  });

  test('function keys, smart backspace and enter', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await page.getByTestId('key-sqrt').first().tap();
    await expect(exprInput(page, 0)).toHaveValue('sqrt()');
    await page.getByTestId('key-backspace').first().tap();
    await expect(exprInput(page, 0)).toHaveValue('');

    await page.getByTestId('keypad-tab-fx').tap();
    await page.getByTestId('key-sin').tap();
    await page.getByTestId('keypad-tab-123').tap();
    await page.getByTestId('key-x').tap();
    await expect(exprInput(page, 0)).toHaveValue('sin(x)');
    await page.getByTestId('key-enter').first().tap();
    await expect(exprInput(page, 1)).toBeFocused();
    // ↵ on the empty last row has nowhere to go: it means done, and the keypad goes away.
    await page.getByTestId('key-enter').first().tap();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await expect(exprInput(page, 1)).not.toBeFocused();
    await expect(page.getByTestId('expr-input')).toHaveCount(2);
  });

  test('hiding the keypad gives the graph more room', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    const withKeypad = await page.getByTestId('graph').boundingBox();
    await page.getByTestId('keypad-hide').tap();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await expect(exprInput(page, 0)).toBeFocused();
    const without = await page.getByTestId('graph').boundingBox();
    expect((without?.height ?? 0) > (withKeypad?.height ?? 0)).toBe(true);
  });
});

test.describe('math keypad on touch devices: editing details', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');

  test('the ⌨ key hands the field to the device keyboard until it blurs', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.tap();
    await page.getByTestId('keypad-tab-abc').tap();
    await page.getByTestId('key-native').tap();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('inputmode', 'text');
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await input.tap();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await input.evaluate((el) => el.blur());
    await expect(input).toHaveAttribute('inputmode', 'none');
    await input.tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
  });

  test('the header ⌨ toggle switches keyboards without losing the field', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.tap();
    await page.getByTestId('keypad-toggle').tap();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('inputmode', 'text');
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await page.getByTestId('keypad-toggle').tap();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('inputmode', 'none');
    await expect(page.getByTestId('keypad')).toBeVisible();
  });

  test('keypad typing keeps the caret of a long expression in view', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.tap();
    await tapKeys(page, ['y', 'eq', ...Array.from({ length: 14 }, () => ['x', 'add', '1']).flat()]);
    // The typeset math scrolls (the input under it holds the text and the caret's offset).
    const math = page.locator('.expr-row').first().locator('.math-view').first();
    const at = async () => ({
      ...(await math.evaluate((el) => ({
        left: el.scrollLeft,
        max: el.scrollWidth - el.clientWidth,
      }))),
      ...(await input.evaluate((el: HTMLInputElement) => ({
        caret: el.selectionStart,
        length: el.value.length,
      }))),
    });
    const end = await at();
    expect(end.max).toBeGreaterThan(100);
    expect(end.caret).toBe(end.length);
    expect(end.max - end.left).toBeLessThan(30);
    // ← reveals the caret too, back at the start.
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(1, 1));
    await tapKeys(page, ['left']);
    const start = await at();
    expect(start.caret).toBe(0);
    expect(start.left).toBe(0);
  });

  test('holding ⌫ stops at an emptied row instead of erasing the one above', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y=x+1');
    await setExpr(page, 1, 'x+12');
    const touch = await touchSession(page);
    await touch.start(await center(page, '[data-testid="key-backspace"]'));
    await page.waitForTimeout(1500);
    await touch.end();
    await expect(exprInput(page, 1)).toHaveValue('');
    await expect(exprInput(page, 0)).toHaveValue('y=x+1');
    await expect(page.getByTestId('expr-input')).toHaveCount(3);
  });

  test('↵ in a slider field finishes editing and closes the keypad', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a=1');
    // By label, not role: the step field is hidden (display: none) once its row loses focus.
    const step = page.locator('input[aria-label="a slider step"]');
    await step.tap();
    await expect(step).toBeFocused();
    await tapKeys(page, ['0', 'dot', '5', 'enter']);
    await expect(step).toHaveValue('0.5');
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await expect(step).not.toBeFocused();
  });

  test('the tapped row stays in view when the keypad opens', async ({ page }) => {
    await openApp(page);
    // (All in view over the keypad: a new curve out of it would move the graph to frame it.)
    for (let i = 0; i < 10; i++) await setExpr(page, i, `y=${i / 2}`);
    await page.getByTestId('keypad-hide').tap();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    const scroller = page.locator('.panel-scroll');
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const area = await box(scroller);
    let lowest = -1;
    for (let i = 0; i <= 10; i++) {
      if (contains(area, await box(exprInput(page, i)))) lowest = i;
    }
    expect(lowest).toBeGreaterThan(0);
    await exprInput(page, lowest).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await expect
      .poll(async () => contains(await box(scroller), await box(exprInput(page, lowest))))
      .toBe(true);
  });

  test('pinching the list or the keypad does not zoom the page', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    const scale = () => page.evaluate(() => window.visualViewport?.scale ?? 1);
    const list = await center(page, '.panel-scroll');
    await pinchOut(page, list.x, list.y);
    await page.waitForTimeout(200);
    expect(await scale()).toBe(1);
    const keys = await center(page, '.keypad-grid');
    await pinchOut(page, keys.x, keys.y);
    await page.waitForTimeout(200);
    expect(await scale()).toBe(1);
  });

  test('dragging the graph keeps the keypad, and the content under the finger', async ({
    page,
  }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    const graph = page.getByTestId('graph');
    const worldY = (py: number) =>
      graph.evaluate((el, y) => {
        const [, , ymin, ymax] = (el.getAttribute('data-view') ?? '').split(',').map(Number);
        const r = el.getBoundingClientRect();
        return ymax - ((y - r.top) / r.height) * (ymax - ymin);
      }, py);
    const g = await box(graph);
    const start = { x: g.x + g.width / 2, y: g.y + g.height / 3 };
    const before = await worldY(start.y);
    const touch = await touchSession(page);
    await touch.start(start);
    for (let i = 1; i <= 5; i++) await touch.move({ x: start.x, y: start.y + i * 10 });
    await page.waitForTimeout(50);
    const during = await worldY(start.y + 50);
    await touch.end();
    expect(Math.abs(during - before)).toBeLessThan(0.2);
    await expect(page.getByTestId('keypad')).toBeVisible();
    // A tap (not a drag) is what dismisses it.
    await graph.tap({ position: { x: 20, y: 20 } });
    await expect(page.getByTestId('keypad')).toHaveCount(0);
  });
});

test.describe('math keypad on a short landscape phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');
  test.use({ viewport: { width: 667, height: 375 } });

  test('the list sits beside the graph and the edited row stays visible', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y=sin(x)');
    await expect(page.getByTestId('keypad')).toBeVisible();
    const scroller = await box(page.locator('.panel-scroll'));
    expect(scroller.height).toBeGreaterThan(80);
    expect(contains(scroller, await box(exprInput(page, 0)))).toBe(true);
    const graph = await box(page.getByTestId('graph'));
    expect(graph.height).toBeGreaterThan(300);
  });
});

test.describe('math keypad on a 320px-wide phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');
  test.use({ viewport: { width: 320, height: 568 } });

  test('every key label fits its key', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    for (const tab of ['123', 'fx', 'abc']) {
      await page.getByTestId(`keypad-tab-${tab}`).tap();
      const clipped = await page
        .locator('.key')
        .evaluateAll((keys) =>
          keys.filter((k) => k.scrollWidth > k.clientWidth).map((k) => k.textContent),
        );
      expect(clipped, `clipped keys on ${tab}`).toEqual([]);
    }
  });
});

test.describe('math keypad on desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('hidden by default and toggled from the header', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).click();
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await expect(exprInput(page, 0)).toHaveAttribute('inputmode', 'text');
    await page.getByTestId('keypad-toggle').click();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await page.getByTestId('key-7').first().click();
    await expect(exprInput(page, 0)).toHaveValue('7');
  });

  test('the ⌨ key switches back to the hardware keyboard', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('keypad-toggle').click();
    await exprInput(page, 0).click();
    await expect(exprInput(page, 0)).toHaveAttribute('inputmode', 'none');
    await page.getByTestId('keypad-tab-abc').click();
    await page.getByTestId('key-native').click();
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(exprInput(page, 0)).toHaveAttribute('inputmode', 'text');
    await expect(page.getByTestId('keypad')).toHaveCount(0);
  });
});
